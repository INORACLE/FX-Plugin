import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import config from "./config.js"

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data")
const FILE = path.join(DIR, "accounts.json")
const PREFIX = "Yz:fxplugin"
const ACCOUNT = gid => `${PREFIX}:acc:${gid}:`

/** 内存镜像，文件模式下同时充当写入缓冲 */
let mem = null
let writing = null
let dirty = false
let broken = false

const DAY = 86400000

const isRedis = () => !broken && !!global.redis?.isReady

export const keyOf = (gid, uid) => `${ACCOUNT(gid)}${uid}`

async function memory() {
  if (mem) return mem
  mem = new Map()
  try {
    const text = await fs.readFile(FILE, "utf8")
    const obj = JSON.parse(text)
    if (obj && typeof obj === "object") for (const [k, v] of Object.entries(obj)) mem.set(k, v)
  } catch {
    /* 首次运行没有文件，忽略 */
  }
  return mem
}

async function flush() {
  if (writing) return writing
  writing = (async () => {
    while (dirty) {
      dirty = false
      try {
        await fs.mkdir(DIR, { recursive: true })
        const obj = Object.fromEntries(await memory())
        await fs.writeFile(FILE, JSON.stringify(obj), "utf8")
      } catch (err) {
        broken = true
        logger.error("[FX] 账户落盘失败，本次会话改用内存存储：", err)
        return
      }
    }
  })()
    .catch(() => {})
    .finally(() => (writing = null))
  return writing
}

/** 读取账户 */
export async function getAccount(gid, uid) {
  const key = keyOf(gid, uid)
  if (isRedis()) {
    try {
      const raw = await global.redis.get(key)
      if (!raw) return null
      return JSON.parse(raw)
    } catch (err) {
      broken = true
      logger.error("[FX] Redis 读取失败，切换到文件存储：", err)
    }
  }
  return (await memory()).get(key) ?? null
}

/** 写入账户 */
export async function setAccount(gid, uid, data) {
  const key = keyOf(gid, uid)
  data.touchedAt = Date.now()
  if (isRedis()) {
    try {
      await global.redis.set(key, JSON.stringify(data))
      return data
    } catch (err) {
      broken = true
      logger.error("[FX] Redis 写入失败，切换到文件存储：", err)
    }
  }
  const m = await memory()
  m.set(key, data)
  dirty = true
  void flush()
  return data
}

export async function delAccount(gid, uid) {
  const key = keyOf(gid, uid)
  if (isRedis()) {
    try {
      await global.redis.del(key)
    } catch {
      /* 落到文件分支 */
    }
  }
  if ((await memory()).delete(key)) {
    dirty = true
    void flush()
  }
}

/** 列出某个群的全部账户 */
export async function listAccounts(gid) {
  const out = []
  const seen = new Set()
  const head = ACCOUNT(gid)
  if (isRedis()) {
    try {
      const keys = await global.redis.keys(`${head}*`)
      for (const key of keys) {
        const raw = await global.redis.get(key)
        if (!raw) continue
        try {
          out.push({ uid: key.slice(head.length), data: JSON.parse(raw) })
          seen.add(key)
        } catch {
          /* 跳过坏数据 */
        }
      }
    } catch (err) {
      broken = true
      logger.error("[FX] Redis 列举失败：", err)
    }
  }
  for (const [key, data] of await memory()) {
    if (seen.has(key) || !key.startsWith(head)) continue
    out.push({ uid: key.slice(head.length), data })
  }
  return out
}

/** 清理长期不活跃的账户 */
export async function gc() {
  const days = Number(config.expireDays) || 0
  if (!days) return 0
  const limit = Date.now() - days * DAY
  let n = 0
  const m = await memory()
  for (const [key, data] of m) {
    if ((data?.touchedAt ?? 0) < limit) {
      m.delete(key)
      n++
    }
  }
  if (n) {
    dirty = true
    void flush()
  }
  if (isRedis()) {
    try {
      const keys = await global.redis.keys(`${PREFIX}:acc:*`)
      for (const key of keys) {
        if (m.has(key)) continue
        const raw = await global.redis.get(key)
        let touched = 0
        try {
          touched = JSON.parse(raw)?.touchedAt ?? 0
        } catch {
          await global.redis.del(key)
          n++
          continue
        }
        if (touched < limit) {
          await global.redis.del(key)
          n++
        }
      }
    } catch {
      /* 忽略清理错误 */
    }
  }
  if (n) logger.mark(`[FX] 已清理 ${logger.cyan(n)} 个闲置账户`)
  return n
}

export const storeMode = () => (isRedis() ? "redis" : broken ? "memory" : "file")
