import config from "./config.js"
import { PAIRS, battleOf, pairOf, digitsOf } from "./constants.js"

/* ------------------------------------------------------------------ *
 * 模拟行情：全局共享，所有玩家看到同一张盘口
 * 随机游走公式与原版一致：正弦漂移 + 随机抖动 + 1.8% 概率的冲击
 * ------------------------------------------------------------------ */

/**
 * 跨热重载共享状态。
 * Yunzai 修改插件后会用 `?时间戳` 重新 import 本模块，模块级变量会全部重置，
 * 但挂到 globalThis 上的对象不会，因此行情与数据集都存在这里，避免热重载后图表变空。
 */
const SHARED = Symbol.for("FX-Plugin.shared")
const shared = (globalThis[SHARED] ??= {
  sim: new Map(),
  datasets: { real: null, battle: new Map() },
  cache: new Map(),
  loading: new Map(),
})

const sim = shared.sim
const CANDLE_MAX = 150

export function seedSim() {
  sim.clear()
  PAIRS.forEach((pair, index) => {
    let value = pair.initial
    const candles = []
    for (let i = 0; i < 76; i++) {
      const open = value
      const wave = Math.sin(i * 0.43 + index * 1.9) * 0.0008 + Math.cos(i * 0.19 + index) * 0.00055
      value = open * (1 + wave + (Math.random() - 0.5) * 0.0019)
      const spread = open * (0.0005 + Math.random() * 0.00065)
      candles.push({
        open,
        high: Math.max(open, value) + spread,
        low: Math.min(open, value) - spread,
        close: value,
      })
    }
    sim.set(pair.id, { candles, price: value })
  })
}

function series(id) {
  if (!sim.has(id)) {
    let value = pairOf(id)?.initial ?? 1
    sim.set(id, { candles: [], price: value })
  }
  return sim.get(id)
}

/** 推进一拍 */
export function tickSim() {
  PAIRS.forEach((pair, index) => {
    const s = series(pair.id)
    const open = s.price
    const drift = Math.sin(Date.now() / 13000 + index * 2) * 0.00036
    const shock = Math.random() < 0.018 ? (Math.random() - 0.5) * 0.019 : 0
    const close = Math.max(open * 0.5, open * (1 + drift + (Math.random() - 0.5) * 0.0042 + shock))
    const wick = open * (Math.random() * 0.0007 + 0.00015)
    s.candles.push({
      open,
      high: Math.max(open, close) + wick,
      low: Math.min(open, close) - wick,
      close,
    })
    if (s.candles.length > CANDLE_MAX) s.candles.shift()
    s.price = close
  })
}

export const simPrice = id => series(id).price

export const simPrevPrice = id => series(id).candles.at(-2)?.close ?? series(id).price

export const simCandles = (id, n = 54) => series(id).candles.slice(-n)

/* ------------------------------------------------------------------ *
 * Frankfurter 历史汇率
 * ------------------------------------------------------------------ */

const QUOTES = ["USD", "GBP", "JPY", "CHF", "AUD", "CAD"]
const cache = shared.cache

/** 把 EUR 基准的报价换算成游戏里的 7 个货币对 */
function buildPrices(r) {
  if (!QUOTES.every(k => Number.isFinite(r[k]) && r[k] > 0)) return null
  return {
    "EUR/USD": r.USD,
    "GBP/USD": r.USD / r.GBP,
    "USD/JPY": r.JPY / r.USD,
    "USD/CHF": r.CHF / r.USD,
    "EUR/CHF": r.CHF,
    "AUD/USD": r.USD / r.AUD,
    "USD/CAD": r.CAD / r.USD,
  }
}

/**
 * 拉取一段历史日度参考汇率
 * @returns {Promise<{date: string, prices: object}[]>}
 */
export async function fetchHistory(start, end = "") {
  const ck = `${start}|${end}`
  const hit = cache.get(ck)
  if (hit && Date.now() - hit.at < config.cacheTTL) return hit.data
  if (hit) {
    // 正在进行中的相同请求直接复用
    if (hit.pending) return hit.pending
  }

  const params = new URLSearchParams({ base: "EUR", quotes: QUOTES.join(",") })
  if (start) params.set("from", start)
  if (end) params.set("to", end)
  const url = `${config.api}/rates?${params}`

  const pending = (async () => {
    const res = await fetch(url, { signal: AbortSignal.timeout(config.timeout) })
    if (!res.ok) throw new Error(`Frankfurter 返回 HTTP ${res.status}`)
    const rows = await res.json()
    if (!Array.isArray(rows) || !rows.length) throw new Error("Frankfurter 未返回数据")

    const byDate = new Map()
    for (const row of rows) {
      if (!byDate.has(row.date)) byDate.set(row.date, {})
      byDate.get(row.date)[row.quote] = row.rate
    }
    const data = []
    for (const [date, r] of [...byDate].sort((a, b) => a[0].localeCompare(b[0]))) {
      const prices = buildPrices(r)
      if (prices) data.push({ date, prices })
    }
    if (!data.length) throw new Error("历史数据不完整")
    return data
  })()

  cache.set(ck, { pending, at: hit?.at ?? 0 })
  try {
    const data = await pending
    cache.set(ck, { data, at: Date.now() })
    return data
  } catch (err) {
    cache.delete(ck)
    throw err
  }
}

/** 近 N 年的真实历史序列 */
export async function fetchReal(years = 2) {
  const since = new Date()
  since.setUTCDate(since.getUTCDate() - Math.round(years * 365))
  return fetchHistory(since.toISOString().slice(0, 10))
}

/** 价格文本 */
export const priceText = (pair, n) => (Number.isFinite(n) ? n.toFixed(digitsOf(pair)) : "—")

/* ------------------------------------------------------------------ *
 * 历史数据集：真实序列与各战役序列，全进程共享
 * ------------------------------------------------------------------ */

export const datasets = shared.datasets

const loading = shared.loading

/** 载入(并缓存)近两年的真实历史序列 */
export async function ensureReal() {
  if (datasets.real) return datasets.real
  if (loading.has("real")) return loading.get("real")
  const job = fetchReal()
    .then(items => {
      if (items.length < 150) throw new Error("历史数据不足")
      datasets.real = items
      loading.delete("real")
      return items
    })
    .catch(err => {
      loading.delete("real")
      throw err
    })
  loading.set("real", job)
  return job
}

/** 载入(并缓存)某场战役的历史序列 */
export async function ensureBattle(id) {
  if (datasets.battle.has(id)) return datasets.battle.get(id)
  if (loading.has(id)) return loading.get(id)
  const meta = battleOf(id)
  if (!meta) throw new Error("战役不存在")
  const job = fetchHistory(meta.start, meta.end)
    .then(items => {
      datasets.battle.set(id, items)
      loading.delete(id)
      return items
    })
    .catch(err => {
      loading.delete(id)
      throw err
    })
  loading.set(id, job)
  return job
}
