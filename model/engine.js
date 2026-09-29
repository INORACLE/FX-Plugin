import config from "./config.js"
import {
  BATTLES,
  FATHER_AID_CASH,
  INIT_CASH,
  LIQUIDATE_RATIO,
  LOAN_MAX,
  MIN_MARGIN,
  RESCUE_RATIO,
  WARN_RATIO,
  battleOf,
  loanDailyRate,
} from "./constants.js"
import { datasets, ensureBattle, ensureReal, simCandles, simPrevPrice, simPrice } from "./market.js"

export function initialState() {
  return {
    cash: INIT_CASH,
    debt: 0,
    loanPrincipal: 0,
    loanRate: 0,
    fatherAidUsed: false,
    positions: [],
    history: [],
    pair: "EUR/USD",
    mode: "sim",
    battleId: null,
    leverage: 20,
    margin: 500,
    real: { cursor: 0, startCursor: 0 },
    battle: { cursor: 0, startCursor: 0, endNotified: false },
    loanStamp: 0,
    createdAt: Date.now(),
  }
}

/** 修正读档数据，避免旧版本/损坏字段导致崩溃 */
export function sanitize(raw) {
  const s = { ...initialState(), ...(raw && typeof raw === "object" ? raw : {}) }
  s.cash = Number.isFinite(s.cash) ? Math.max(0, s.cash) : INIT_CASH
  s.debt = Math.max(0, Number(s.debt) || 0)
  s.loanPrincipal = s.debt > 0 ? Math.max(1, Number(s.loanPrincipal) || s.debt) : 0
  s.loanRate = s.debt > 0 ? loanDailyRate(s.loanPrincipal) : 0
  s.leverage = Math.max(1, Math.min(100, Math.floor(Number(s.leverage) || 20)))
  s.margin = Math.max(MIN_MARGIN, Number(s.margin) || 500)
  s.fatherAidUsed = !!s.fatherAidUsed
  s.mode = ["sim", "real", "battle"].includes(s.mode) ? s.mode : "sim"
  if (!BATTLES.some(b => b.id === s.battleId)) s.battleId = null
  if (s.mode === "battle" && !s.battleId) s.mode = "sim"
  s.positions = (Array.isArray(s.positions) ? s.positions : [])
    .filter(p => p && typeof p.pair === "string" && Number.isFinite(p.entry))
    .slice(0, 50)
    .map((p, i) => ({
      id: String(p.id ?? `r${i}`),
      pair: p.pair,
      side: p.side === -1 ? -1 : 1,
      entry: p.entry,
      margin: Math.max(0, Number(p.margin) || 0),
      leverage: Math.max(1, Math.min(100, Math.floor(Number(p.leverage) || 20))),
      notional:
        Number.isFinite(p.notional) && p.notional > 0 ? p.notional : (Number(p.margin) || 0) * 20,
      opened: p.opened || "",
      warned: !!p.warned,
    }))
  s.history = (Array.isArray(s.history) ? s.history : []).slice(0, 25)
  s.real = { ...initialState().real, ...(s.real || {}) }
  s.battle = { ...initialState().battle, ...(s.battle || {}) }
  return s
}

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n))

/* ------------------------------------------------------------------ *
 * 行情视图：把玩家状态绑定到对应的价格来源
 * ------------------------------------------------------------------ */
export function view(state) {
  if (state.mode === "real" && datasets.real) {
    const items = datasets.real
    const i = clamp(Math.floor(state.real.cursor) || 0, 0, items.length - 1)
    return {
      kind: "real",
      label: "真实历史数据",
      date: items[i].date,
      index: i,
      total: items.length,
      canNext: i < items.length - 1,
      priceOf: p => items[i].prices[p],
      previousOf: p => items[Math.max(0, i - 1)].prices[p],
      historyOf: (p, n = 54) =>
        items
          .slice(Math.max(0, i - n + 1), i + 1)
          .map(r => r.prices[p])
          .filter(Number.isFinite),
    }
  }
  if (state.mode === "battle" && state.battleId && datasets.battle.has(state.battleId)) {
    const items = datasets.battle.get(state.battleId)
    const i = clamp(Math.floor(state.battle.cursor) || 0, 0, items.length - 1)
    const meta = battleOf(state.battleId)
    return {
      kind: "battle",
      label: `经典战役 · ${meta?.title ?? state.battleId}`,
      date: items[i].date,
      index: i,
      total: items.length,
      event: meta?.event,
      canNext: i < items.length - 1,
      priceOf: p => items[i].prices[p],
      previousOf: p => items[Math.max(0, i - 1)].prices[p],
      historyOf: (p, n = 54) =>
        items
          .slice(Math.max(0, i - n + 1), i + 1)
          .map(r => r.prices[p])
          .filter(Number.isFinite),
    }
  }
  return {
    kind: "sim",
    label: "模拟行情",
    date: null,
    index: null,
    total: null,
    canNext: false,
    priceOf: p => simPrice(p),
    previousOf: p => simPrevPrice(p),
    historyOf: (p, n = 54) =>
      simCandles(p, n)
        .map(c => c.close)
        .filter(Number.isFinite),
  }
}

/* ------------------------------------------------------------------ *
 * 结算
 * ------------------------------------------------------------------ */

export const positionPnl = (pos, v) => {
  const price = v.priceOf(pos.pair)
  if (!Number.isFinite(price) || !price) return 0
  return pos.notional * pos.side * (price / pos.entry - 1)
}

export const riskRatio = (pos, v) => Math.max(0, -positionPnl(pos, v) / (pos.margin || 1))

export function account(state, v) {
  const used = state.positions.reduce((sum, p) => sum + p.margin, 0)
  const floating = state.positions.reduce((sum, p) => sum + positionPnl(p, v), 0)
  return { used, floating, equity: state.cash + used + floating - state.debt }
}

export function accrueLoanInterest(state) {
  if (state.debt <= 0) return
  state.debt =
    Math.round((state.debt + Math.round(state.debt * state.loanRate * 100) / 100) * 100) / 100
}

/** 模拟模式下按真实经过的时间补算利息 */
function catchUpLoan(state) {
  if (state.debt <= 0 || state.mode !== "sim") return
  if (!state.loanStamp) {
    state.loanStamp = Date.now()
    return
  }
  const perDay = Math.max(1, config.simTickMs * config.loanDayTicks)
  const days = Math.floor((Date.now() - state.loanStamp) / perDay)
  if (days <= 0) return
  for (let i = 0; i < days; i++) accrueLoanInterest(state)
  state.loanStamp += days * perDay
}

function closeOne(state, v, id, liquidated) {
  const index = state.positions.findIndex(p => p.id === id)
  if (index < 0) return null
  const pos = state.positions[index]
  const pnl = Math.max(-pos.margin, positionPnl(pos, v))
  state.cash = Math.max(0, state.cash + Math.max(0, pos.margin + pnl))
  state.positions.splice(index, 1)
  state.history.unshift({
    pair: pos.pair,
    side: pos.side,
    pnl,
    liquidated,
    time: new Date().toLocaleDateString("zh-CN"),
  })
  state.history = state.history.slice(0, 25)

  const result = { pos, pnl, liquidated, fatherAid: null }
  if (liquidated && !state.fatherAidUsed && account(state, v).equity < 0) {
    state.fatherAidUsed = true
    result.fatherAid = { debt: state.debt, cleared: state.positions.length }
    state.debt = 0
    state.loanPrincipal = 0
    state.loanRate = 0
    state.loanStamp = 0
    state.positions = []
    state.cash = FATHER_AID_CASH
  }
  return result
}

/**
 * 读取账户并结算到期事件（利息 / 爆仓）
 * @returns {{state: object, view: object, events: string[]}}
 */
export function refresh(raw) {
  const state = sanitize(raw)
  const v = view(state)
  const events = []

  catchUpLoan(state)

  for (const pos of [...state.positions]) {
    const ratio = riskRatio(pos, v)
    if (ratio < 0.55) pos.warned = false
    if (ratio >= LIQUIDATE_RATIO) {
      const res = closeOne(state, v, pos.id, true)
      if (res) {
        events.push(
          `✕ ${res.pos.pair} ${res.pos.side === 1 ? "做多" : "做空"}已触发爆仓，亏损触及保证金的 80%`,
        )
        if (res.fatherAid) {
          events.push(
            `♡ 父亲的援助：已还清贷款 ${res.fatherAid.debt.toFixed(2)}` +
              (res.fatherAid.cleared ? ` · 其余 ${res.fatherAid.cleared} 笔持仓已结清` : "") +
              ` · 账户恢复为 $${FATHER_AID_CASH.toLocaleString("en-US")}`,
          )
        }
      }
      continue
    }
    if (ratio >= WARN_RATIO && !pos.warned) {
      pos.warned = true
      const idx = state.positions.indexOf(pos) + 1
      const suggest = Math.max(1, Math.ceil(-positionPnl(pos, v) / RESCUE_RATIO - pos.margin))
      events.push(
        `! ${pos.pair} ${pos.side === 1 ? "做多" : "做空"}已亏损保证金的 ${(ratio * 100).toFixed(1)}%\n` +
          `  补仓建议 $${suggest.toFixed(2)} → #外汇补仓 ${idx} ${Math.ceil(suggest)}`,
      )
    }
  }
  return { state, view: v, events }
}

/* ------------------------------------------------------------------ *
 * 交易动作
 * ------------------------------------------------------------------ */

export function openPosition(state, v, { side, margin, leverage }) {
  if (!Number.isFinite(margin) || margin < MIN_MARGIN)
    return { ok: false, msg: `保证金至少为 $${MIN_MARGIN}。` }
  if (margin > state.cash + 0.001)
    return { ok: false, msg: "可用余额不足，请减少保证金或先 #外汇贷款 借钱。" }
  const entry = v.priceOf(state.pair)
  if (!Number.isFinite(entry)) return { ok: false, msg: "行情尚未准备好，请稍后再试。" }
  const lev = Math.max(1, Math.min(100, Math.floor(Number(leverage) || state.leverage || 20)))

  state.margin = margin
  state.leverage = lev
  state.cash = Math.max(0, state.cash - margin)
  const pos = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    pair: state.pair,
    side,
    entry,
    margin,
    leverage: lev,
    notional: margin * lev,
    opened: new Date().toLocaleString("zh-CN"),
    warned: false,
  }
  state.positions.unshift(pos)
  return { ok: true, pos }
}

export const closePosition = (state, v, id, liquidated = false) =>
  closeOne(state, v, id, liquidated)

export function closeByIndex(state, v, token) {
  if (token === "全部" || token === "all") {
    if (!state.positions.length) return { ok: false, msg: "当前没有持仓。" }
    const ids = state.positions.map(p => p.id)
    let total = 0
    for (const id of ids) total += closeOne(state, v, id, false)?.pnl ?? 0
    return { ok: true, count: ids.length, pnl: total, all: true }
  }
  const i = Number.parseInt(token, 10)
  if (!Number.isInteger(i) || i < 1 || i > state.positions.length)
    return { ok: false, msg: "序号不存在，发送 #外汇持仓 查看当前持仓。" }
  const target = state.positions[i - 1]
  const res = closeOne(state, v, target.id, false)
  return { ok: true, count: 1, pnl: res.pnl, pos: res.pos, all: false }
}

export function borrowLoan(state, amount, pos = null) {
  if (!Number.isFinite(amount) || amount < 1 || amount > LOAN_MAX)
    return { ok: false, msg: `请输入 $1–$${LOAN_MAX.toLocaleString("en-US")} 的借款金额。` }
  if (state.debt > 0) return { ok: false, msg: "请先 #外汇还款，再申请新贷款。" }
  state.debt = amount
  state.loanPrincipal = amount
  state.loanRate = loanDailyRate(amount)
  state.loanStamp = Date.now()
  if (pos) pos.margin += amount
  else state.cash += amount
  return { ok: true }
}

export function repayLoan(state, amount) {
  if (state.debt <= 0) return { ok: false, msg: "现在没有待还贷款。" }
  if (state.cash < 0.01) return { ok: false, msg: "可用余额不足，暂时无法还款。" }
  const max = Math.min(state.debt, state.cash)
  const amt = Math.min(amount ?? max, max)
  if (!Number.isFinite(amt) || amt < 0.01) return { ok: false, msg: "还款金额超出可用范围。" }
  state.cash = Math.max(0, state.cash - amt)
  state.debt = Math.max(0, state.debt - amt)
  if (state.debt < 0.005) {
    state.debt = 0
    state.loanPrincipal = 0
    state.loanRate = 0
    state.loanStamp = 0
  }
  return { ok: true, amount: amt }
}

export function addMarginTo(state, pos, amount, borrow = false) {
  const available = borrow ? LOAN_MAX : state.cash
  if (!Number.isFinite(amount) || amount < 1 || amount > available + 0.001)
    return {
      ok: false,
      msg: borrow
        ? `借款补仓金额应为 $1–$${LOAN_MAX.toLocaleString("en-US")}。`
        : "补仓金额不能超过可用余额。",
    }
  if (borrow) {
    const res = borrowLoan(state, amount, pos)
    if (!res.ok) return res
  } else {
    state.cash = Math.max(0, state.cash - amount)
    pos.margin += amount
  }
  return { ok: true, pos, amount }
}

/* ------------------------------------------------------------------ *
 * 输入解析
 * ------------------------------------------------------------------ */

/** 解析金额：500 / $500 / 1k / 2w / 50% / max */
export function parseAmount(input, cash = 0) {
  if (input === undefined || input === null) return null
  const raw = String(input)
    .trim()
    .replace(/[＄$￥,\s]/g, "")
  if (!raw) return null
  if (/^(max|all|全部|最大|满仓)$/i.test(raw)) return Math.max(0, cash)
  const pct = raw.match(/^([\d.]+)\s*%$/)
  if (pct) {
    const p = Number(pct[1])
    return Number.isFinite(p) ? (cash * p) / 100 : null
  }
  const m = raw.match(/^([\d.]+)\s*(k|w|万|千)?$/i)
  if (!m) return null
  let n = Number(m[1])
  if (!Number.isFinite(n) || n < 0) return null
  const unit = (m[2] || "").toLowerCase()
  if (unit === "k" || unit === "千") n *= 1000
  else if (unit === "w" || unit === "万") n *= 10000
  return n
}

/* ------------------------------------------------------------------ *
 * 行情模式
 * ------------------------------------------------------------------ */

export async function setMode(state, mode) {
  if (mode === state.mode) return { ok: true, state }
  if (state.positions.length)
    return { ok: false, msg: "请先 #外汇平仓全部 平掉当前持仓，再切换行情模式。" }
  if (mode === "real") {
    try {
      const items = await ensureReal()
      const startCursor = Math.max(29, items.length - 260)
      state.mode = "real"
      state.real = { cursor: startCursor, startCursor }
    } catch (err) {
      return { ok: false, msg: `真实历史数据读取失败：${err.message}。稍后再试或先用 #外汇模拟。` }
    }
  } else if (mode === "battle") {
    return { ok: false, msg: "请发送 #外汇战役 选择一场经典战役。" }
  } else {
    state.mode = "sim"
    state.battleId = null
  }
  state.loanStamp = Date.now()
  return { ok: true, state }
}

export async function startBattle(state, id) {
  const meta = battleOf(id)
  if (!meta) return { ok: false, msg: "没有这场战役，发送 #外汇战役 查看列表。" }
  if (state.positions.length && state.mode !== "battle")
    return { ok: false, msg: "请先 #外汇平仓全部 平掉当前持仓，再切换战役。" }
  if (state.positions.length && state.mode === "battle" && state.battleId !== id)
    return { ok: false, msg: "请先 #外汇平仓全部 平掉当前持仓，再切换战役。" }
  let items
  try {
    items = await ensureBattle(id)
  } catch (err) {
    return { ok: false, msg: `战役数据读取失败：${err.message}。稍后再试。` }
  }
  const eventIndex = items.findIndex(row => row.date >= meta.event)
  if (items.length < 15 || eventIndex < 2) return { ok: false, msg: "战役历史数据不足，无法回放。" }
  const startCursor = eventIndex - 1
  const keep = state.mode === "battle" && state.battleId === id && state.positions.length
  state.mode = "battle"
  state.battleId = id
  state.pair = meta.pair
  state.battle = {
    cursor: keep ? state.battle.cursor : startCursor,
    startCursor,
    endNotified: false,
  }
  state.loanStamp = Date.now()
  return { ok: true, meta, items, startCursor, resumed: !!keep }
}

/** 推进一个交易日 */
export function nextDay(state, v, times = 1) {
  if (state.mode === "sim") return { ok: false, msg: "模拟行情会自动跳动，无需手动推进交易日。" }
  if (!v.canNext) return { ok: false, msg: "已经到达最后一个交易日了。" }
  const remaining = v.total - v.index - 1
  const n = Math.max(0, Math.min(Math.floor(times) || 1, remaining))
  if (!n) return { ok: false, msg: "已经到达最后一个交易日了。" }
  for (let i = 0; i < n; i++) {
    if (state.mode === "battle") state.battle.cursor++
    else state.real.cursor++
    accrueLoanInterest(state)
  }
  return { ok: true, days: n, state }
}

export function replaySeries(state) {
  if (state.mode === "sim") return { ok: false, msg: "当前是模拟行情，没有回放起点。" }
  if (state.positions.length) return { ok: false, msg: "请先 #外汇平仓全部，再回到起点。" }
  if (state.mode === "battle") {
    state.battle.cursor = state.battle.startCursor
    state.battle.endNotified = false
  } else {
    state.real.cursor = state.real.startCursor
  }
  return { ok: true }
}
