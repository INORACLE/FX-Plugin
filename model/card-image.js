import { fileURLToPath } from "node:url"
import path from "node:path"
import puppeteer from "../../../lib/puppeteer/puppeteer.js"
import { BATTLES, PAIRS, PLUGIN_NAME, pairOf } from "./constants.js"
import { priceText } from "./market.js"
import { pct, sign } from "./render.js"

const TPL_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "resources")
const tpl = name => path.join(TPL_DIR, name, "index.html")
/** 货币对 id 形如 EUR/USD，含斜杠，不能直接进 saveId */
const slug = s =>
  String(s)
    .replace(/[^a-z0-9]+/gi, "-")
    .toLowerCase()

/* ------------------------------------------------------------------ *
 * 通用：渲染失败一律回退文字，保证指令永远有回复
 * ------------------------------------------------------------------ */
async function shot(saveId, tplName, data, fallback) {
  try {
    const img = await puppeteer.screenshot(PLUGIN_NAME, {
      tplFile: tpl(tplName),
      saveId,
      imgType: "png",
      quality: 100,
      ...data,
    })
    if (img) return img
    logger.warn(`[${PLUGIN_NAME}] ${saveId} 图片为空，回退文字`)
  } catch (err) {
    logger.error(`[${PLUGIN_NAME}] ${saveId} 渲染失败，回退文字：${err?.message ?? err}`)
    logger.debug(err)
  }
  return fallback
}

/* ------------------------------------------------------------------ *
 * 走势图
 * ------------------------------------------------------------------ */
const W = 844
const H = 300
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n))

/** 把数值序列画成 SVG 折线坐标 */
function sparkPath(vals, min, max) {
  if (vals.length < 2) return ""
  const span = max - min || 1
  return vals
    .map((v, i) => {
      const x = (i / (vals.length - 1)) * W
      const y = H - ((v - min) / span) * H
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(" ")
}

/** 单点在同一坐标系里的位置，用于折线末端的圆点 */
function pointAt(value, min, max) {
  const span = max - min || 1
  return { x: W.toFixed(1), y: (H - ((value - min) / span) * H).toFixed(1) }
}

/**
 * 走势图图片：模拟行情 / 真实历史 / 经典战役共用
 */
export async function chartImage(v, pair, fallback) {
  const vals = v.historyOf(pair, 90).filter(Number.isFinite)
  if (vals.length < 2) return fallback

  const meta = pairOf(pair)
  const digits = meta?.digits ?? 5
  const last = vals.at(-1)
  const first = vals[0]
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const up = last >= first
  const stroke = up ? "#4fbf9a" : "#e8697d"
  const change = ((last / first - 1) * 100).toFixed(2)

  const isReplay = v.kind === "real" || v.kind === "battle"
  const eventX =
    v.kind === "battle" && v.event && v.index > 0 && v.total > 1
      ? { x: (((v.index - 0.5) / (v.total - 1)) * W).toFixed(1) }
      : null

  return shot(
    `chart-${v.kind}-${slug(pair)}`,
    "chart",
    {
      eyebrow: PLUGIN_NAME,
      pairName: `${pair}${meta?.name ? ` · ${meta.name}` : ""}`,
      sub: isReplay
        ? `${v.kind === "battle" ? v.label : "真实历史数据"}${v.date ? ` · ${v.date}` : ""}`
        : "模拟行情 · 实时跳动",
      price: last.toFixed(digits),
      change: `${sign(last - first)} ${pct(change)}`,
      changeClass: up ? "up" : "down",
      line: sparkPath(vals, min, max),
      area: `0,${H} ${sparkPath(vals, min, max)} ${W},${H}`,
      stroke,
      fillId: up ? "fillUp" : "fillDown",
      gridlines: [0.25, 0.5, 0.75].map(f => ({ y: (H * f).toFixed(1) })),
      axisMin: min.toFixed(digits),
      axisMax: max.toFixed(digits),
      last: pointAt(last, min, max),
      event: eventX,
      progress: isReplay
        ? {
            pct: clamp(((v.index + 1) / v.total) * 100, 0, 100).toFixed(1),
            text: `第 ${v.index + 1} / ${v.total} 个交易日`,
          }
        : null,
      cmds: isReplay
        ? ["#外汇下一日", "#外汇图表", "#外汇回到起点"]
        : ["#外汇图表", "#外汇行情", "#外汇切换 欧元"],
      foot: "日度参考价不展示盘中极端波动 · 不构成投资建议",
    },
    fallback,
  )
}

/* ------------------------------------------------------------------ *
 * 盘口
 * ------------------------------------------------------------------ */
export async function quotesImage(state, v, fallback) {
  const rows = PAIRS.map((p, i) => {
    const rate = v.priceOf(p.id)
    const prev = v.previousOf(p.id)
    const change = Number.isFinite(prev) && prev ? (rate / prev - 1) * 100 : 0
    const up = change >= 0
    const hist = v.historyOf(p.id, 24).filter(Number.isFinite)
    const mn = hist.length ? Math.min(...hist) : 0
    const mx = hist.length ? Math.max(...hist) : 0
    return {
      no: i + 1,
      id: p.id,
      name: p.name,
      rate: priceText(p.id, rate),
      change: `${sign(change)} ${pct(change)}`,
      cls: up ? "up" : "down",
      stroke: up ? "#4fbf9a" : "#e8697d",
      spark: sparkPath(hist, mn, mx || mn + 1)
        .split(" ")
        .map((p, k) => {
          const [x, y] = p.split(",")
          return `${((Number(x) / W) * 84).toFixed(1)},${((Number(y) / H) * 26).toFixed(1)}`
        })
        .join(" "),
      current: state.pair === p.id,
    }
  })

  return shot(
    "quotes",
    "quotes",
    {
      eyebrow: PLUGIN_NAME,
      title: "盘口",
      sub:
        v.kind === "sim"
          ? "模拟行情 · 每 1.5 秒跳动一次"
          : `${v.label}${v.date ? ` · ${v.date}` : ""}`,
      rows,
      foot: "发送 #外汇切换 3 切换当前货币对 · #外汇图表 看走势图",
    },
    fallback,
  )
}

/* ------------------------------------------------------------------ *
 * 经典战役
 * ------------------------------------------------------------------ */
export async function battlesImage(fallback) {
  return shot(
    "battles",
    "battles",
    {
      eyebrow: PLUGIN_NAME,
      title: "经典战役",
      sub: "用当年的真实日度汇率逐日回放，从事件前一个交易日出发",
      battles: BATTLES.map((b, i) => ({
        no: i + 1,
        title: b.title,
        pair: b.pair,
        desc: b.description,
        event: b.event,
        start: b.start,
        end: b.end,
      })),
      foot: "发送 #外汇战役 1 进入第 1 场 · 进入后用 #外汇下一日 逐日推进",
    },
    fallback,
  )
}
