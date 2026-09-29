import config from "./config.js"
import {
  BATTLES,
  FATHER_AID_CASH,
  INIT_CASH,
  LIQUIDATE_RATIO,
  LOAN_MAX,
  MIN_MARGIN,
  PAIRS,
  PLUGIN_NAME,
  TUTORIAL,
  WARN_RATIO,
  pairOf,
  rateText,
} from "./constants.js"
import { account, positionPnl, riskRatio } from "./engine.js"
import { priceText } from "./market.js"

const WIDTH = 34
const ROWS = 7

export const money = n =>
  `${n < 0 ? "-" : ""}$${Math.abs(Number(n) || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`

export const signedMoney = n =>
  `${Number(n) >= 0 ? "+" : "-"}$${Math.abs(Number(n) || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`

export const pct = n => `${Number(n) >= 0 ? "+" : ""}${(Number(n) || 0).toFixed(2)}%`

export const sign = n => (n > 0 ? "🟢" : n < 0 ? "🔴" : "⚪")
const bar = (ratio, len = 10) => {
  const filled = Math.max(0, Math.min(len, Math.round(ratio * len)))
  return "█".repeat(filled) + "░".repeat(len - filled)
}

/* ------------------------------------------------------------------ *
 * 图表：用方块字符画出迷你 K 线 / 折线
 * ------------------------------------------------------------------ */
export function chart(state, v, pair, width = WIDTH) {
  const vals = v.historyOf(pair, width)
  if (vals.length < 2) return `${pair} 行情数据不足，稍等几拍再试。`
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const span = max - min || Math.abs(max) * 0.0006 || 1
  const grid = Array.from({ length: ROWS }, () => Array(vals.length).fill(" "))

  const rowOf = value =>
    Math.max(0, Math.min(ROWS - 1, Math.round((1 - (value - min) / span) * (ROWS - 1))))
  let prev = rowOf(vals[0])
  grid[prev][0] = "●"
  for (let i = 1; i < vals.length; i++) {
    const cur = rowOf(vals[i])
    // 连接相邻两点，避免出现断续的阶梯
    const step = cur > prev ? 1 : -1
    for (let r = prev + step; r !== cur + step; r += step) {
      if (r >= 0 && r < ROWS && grid[r][i] === " ") grid[r][i] = "│"
    }
    grid[cur][i] = "●"
    prev = cur
  }

  const d = pairOf(pair)?.digits ?? 5
  const label = n => n.toFixed(d)
  const lines = [`${pair} · ${v.kind === "sim" ? "模拟走势" : "历史回放"}`]
  for (let r = 0; r < ROWS; r++) {
    const value = max - (r / (ROWS - 1)) * span
    lines.push(`${label(value).padStart(9)} ┤${grid[r].join("")}`)
  }
  lines.push(`${label(min).padStart(9)} ┤`)
  const last = vals.at(-1)
  const change = ((last / vals[0] - 1) * 100).toFixed(2)
  lines.push(
    `区间 ${label(min)} ~ ${label(max)}   现价 ${sign(last - vals[0])} ${label(last)}  ${pct(change)}`,
  )
  if (v.kind === "real" || v.kind === "battle") {
    lines.push(`进度 ${v.index + 1} / ${v.total} 个交易日${v.date ? `   当前 ${v.date}` : ""}`)
  } else {
    lines.push(`每 ${(config.simTickMs / 1000).toFixed(1)} 秒更新一次 · ← 过去   现在 →`)
  }
  return lines.join("\n")
}

/* ------------------------------------------------------------------ *
 * 账户总览
 * ------------------------------------------------------------------ */
export function accountPanel(state, v) {
  const a = account(state, v)
  const price = priceText(state.pair, v.priceOf(state.pair))
  const prev = v.previousOf(state.pair)
  const change = Number.isFinite(prev) && prev ? (v.priceOf(state.pair) / prev - 1) * 100 : 0
  const modeText = v.kind === "real" ? "真实数据" : v.kind === "battle" ? "经典战役" : "模拟行情"
  const lines = [
    `✦ FX 简单! · 交易室`,
    `━━━━━━━━━━━━━━━`,
    `账户总权益 ${sign(a.floating)} ${money(a.equity)}`,
    `可用余额   ${money(state.cash)}`,
    `浮动盈亏   ${a.floating >= 0 ? "🟢" : "🔴"} ${signedMoney(a.floating)}`,
    `已用保证金 ${money(a.used)}`,
    `待还贷款   ${state.debt > 0 ? money(state.debt) : money(0)}`,
    `━━━━━━━━━━━━━━━`,
    `${state.pair} ${pairOf(state.pair)?.name ?? ""}  ${priceText(state.pair, v.priceOf(state.pair))}  ${pct(change)}`,
    `模式 ${modeText}${v.date ? ` · ${v.date}` : ""} · 杠杆 ${state.leverage}×`,
  ]
  if (state.debt > 0) {
    lines.push(
      `贷款 本金 ${money(state.loanPrincipal)} · 日利率 ${rateText(state.loanRate)} · 待还 ${money(state.debt)}`,
    )
  }
  if (state.positions.length) lines.push(`持仓 ${state.positions.length} 笔 · #外汇持仓 查看`)
  if (state.fatherAidUsed) lines.push(`父亲的援助已使用，账户重置过 1 次`)
  lines.push(`#外汇帮助 查看全部指令`)
  return lines.join("\n")
}

/* ------------------------------------------------------------------ *
 * 行情列表
 * ------------------------------------------------------------------ */
export function pairList(state, v) {
  const lines = [`MARKET WATCH · 货币对`, `你在看的：${state.pair}`]
  PAIRS.forEach((p, i) => {
    const rate = v.priceOf(p.id)
    const prev = v.previousOf(p.id)
    const change = Number.isFinite(prev) && prev ? (rate / prev - 1) * 100 : 0
    const star = state.pair === p.id ? "▶" : " "
    lines.push(
      `${star}${i + 1}. ${p.id.padEnd(8)} ${priceText(p.id, rate).padStart(10)}  ${sign(change)} ${pct(change)}`,
    )
  })
  lines.push(`发送 #外汇切换 欧元 可切换当前货币对`)
  return lines.join("\n")
}

/* ------------------------------------------------------------------ *
 * 持仓
 * ------------------------------------------------------------------ */
export function positions(state, v) {
  if (!state.positions.length) return "还没有持仓，发送 #外汇做多 500 20 开一笔试试。"
  const lines = [
    `持仓 ${state.positions.length} 笔 · 合计保证金 ${money(account(state, v).used)}`,
    "━".repeat(30),
  ]
  state.positions.forEach((pos, i) => {
    const pnl = positionPnl(pos, v)
    const ratio = riskRatio(pos, v)
    const roe = pos.margin ? (pnl / pos.margin) * 100 : 0
    const warn = ratio >= WARN_RATIO ? " ⚠风险偏高" : ""
    lines.push(
      `${i + 1}. ${pos.pair} ${pos.side === 1 ? "做多" : "做空"}${warn}`,
      `   保证金 ${money(pos.margin)} · ${pos.leverage}× · 仓位 ${money(pos.notional)}`,
      `   开仓 ${priceText(pos.pair, pos.entry)} → 现价 ${priceText(pos.pair, v.priceOf(pos.pair))}`,
      `   盈亏 ${pnl >= 0 ? "🟢" : "🔴"} ${signedMoney(pnl)} (${pct(roe)})   风险 ${bar(ratio)} ${(ratio * 100).toFixed(0)}%`,
      `   平仓 #外汇平仓${i + 1} · 补仓 #外汇补仓${i + 1} 100`,
    )
  })
  lines.push("━".repeat(30))
  lines.push(
    `亏损达到 ${(LIQUIDATE_RATIO * 100).toFixed(0)}% 强制爆仓，${(WARN_RATIO * 100).toFixed(0)}% 会收到风险提醒。`,
  )
  return lines.join("\n")
}

/* ------------------------------------------------------------------ *
 * 交易记录
 * ------------------------------------------------------------------ */
export function tradeLog(state) {
  if (!state.history.length) return "还没有结算记录，先开一笔交易吧。"
  const lines = [`最近结算（${state.history.length} 条）`, "━".repeat(30)]
  state.history.slice(0, 8).forEach((h, i) => {
    lines.push(
      `${String(i + 1).padStart(2)}. ${h.pair} ${h.side === 1 ? "做多" : "做空"} ${h.liquidated ? "爆仓" : "平仓"} ${h.time}  ${h.pnl >= 0 ? "🟢" : "🔴"} ${signedMoney(h.pnl)}`,
    )
  })
  return lines.join("\n")
}

/* ------------------------------------------------------------------ *
 * 教程 / 帮助 / 战役
 * ------------------------------------------------------------------ */
export function tutorial(step = 1) {
  const i = Math.max(1, Math.min(TUTORIAL.length, Number(step) || 1)) - 1
  const t = TUTORIAL[i]
  return [
    `新手教程 ${i + 1} / ${TUTORIAL.length}`,
    "━".repeat(20),
    `${t.icon} ${t.title}`,
    "",
    t.text,
    "",
    `💡 ${t.example}`,
    "",
    i + 1 < TUTORIAL.length
      ? `下一步 #外汇教程 ${i + 2}   ·   退出 #外汇`
      : `都学会了，发送 #外汇 开始你的第一笔交易！`,
  ].join("\n")
}

export function battleList() {
  const lines = [`经典战役 · 用当年的真实日度汇率逐日回放`, "━".repeat(24)]
  BATTLES.forEach((b, i) => {
    lines.push(
      `${i + 1}. ${b.title}  ${b.pair}`,
      `   事件日 ${b.event} · 回放 ${b.start} ~ ${b.end}`,
      `   ${b.description}`,
    )
  })
  lines.push("━".repeat(24))
  lines.push(`选择一场：#外汇战役 1    查看行情：#外汇图表`)
  return lines.join("\n")
}

export function battleBrief(meta) {
  return [
    `⚔ ${meta.title}`,
    `${meta.pair} · 事件日 ${meta.event}`,
    meta.description,
    `从事件前一个交易日出发，逐日推进；日度参考价不展示盘中极端波动。`,
  ].join("\n")
}

/* ------------------------------------------------------------------ *
 * 指令表：图片与文字共用同一份数据，避免两边描述漂移
 * ------------------------------------------------------------------ */

/** 一条指令：[子命令, 参数占位, 说明]，占位为空则不显示 */
const row = (cmd, arg, desc) => ({ cmd, arg, desc })

/* ---------- 文字版：图片渲染失败时的兜底 ---------- */

/** 终端里 CJK / emoji 占两列，对齐前必须自己算宽度 */
const isWide = cp =>
  (cp >= 0x1100 && cp <= 0x115f) ||
  cp === 0x2329 ||
  cp === 0x232a ||
  (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) ||
  (cp >= 0xac00 && cp <= 0xd7a3) ||
  (cp >= 0xf900 && cp <= 0xfaff) ||
  (cp >= 0xfe10 && cp <= 0xfe19) ||
  (cp >= 0xfe30 && cp <= 0xfe6f) ||
  (cp >= 0xff00 && cp <= 0xff60) ||
  (cp >= 0xffe0 && cp <= 0xffe6) ||
  (cp >= 0x1f300 && cp <= 0x1f9ff)

const strWidth = s => [...String(s)].reduce((n, ch) => n + (isWide(ch.codePointAt(0)) ? 2 : 1), 0)
const pad = (s, width) => s + " ".repeat(Math.max(1, width - strWidth(s)))
/** 去掉规则里的 <i> 标签，得到纯文本 */
const stripTags = s => String(s).replace(/<[^>]+>/g, "")

/** 指令表的唯一数据源：图片版与文字版共用，避免两边描述漂移 */
export function helpModel() {
  const sim = (config.simTickMs / 1000).toFixed(1)
  return {
    pluginName: PLUGIN_NAME,
    title: "FX 简单! · 交易室",
    subtitle: "模拟外汇保证金交易，用小本金体验杠杆与爆仓。全部指令如下。",
    aliases: ["#外汇", "#fx", "#forex", "首个 # 可省略", "命令与参数空格可省"],
    sections: [
      {
        title: "账户",
        items: [
          row("#外汇", "", "账户总览：余额、持仓、浮盈亏、贷款、总权益"),
          row("#外汇教程", "[1-5]", "新手教程，不带数字从第 1 步开始"),
          row("#外汇排行", "[人数]", "群内账户总权益排行"),
          row("#外汇持仓", "", "持仓明细、浮动盈亏与爆仓风险"),
          row("#外汇记录", "", "最近已结算的交易"),
          row("#外汇重开", "确认", "清空余额、持仓、贷款，重新开局"),
        ],
      },
      {
        title: "行情",
        items: [
          row("#外汇行情", "", `全部 ${PAIRS.length} 个货币对盘口`),
          row("#外汇图表", "[货币对]", "迷你走势图，省略则看当前货币对"),
          row("#外汇价格", "[货币对]", "只看某一个的现价与涨跌"),
          row("#外汇切换", "[货币对]", "切换当前货币对，省略则列出全部"),
        ],
      },
      {
        title: "交易",
        items: [
          row("#外汇做多", "保证金 [杠杆]", "开多，杠杆 1-100，例：做多 500 20"),
          row("#外汇做空", "保证金 [杠杆]", "开空，杠杆省略则沿用上次设置"),
          row("#外汇平仓", "[序号|全部]", "平仓结算，不带参数等同 #外汇持仓"),
          row("#外汇补仓", "[序号] [金额]", "追加现金保证金，例：补仓1 200"),
          row("#外汇借补", "[序号] [金额]", "借钱直接补进该笔保证金"),
        ],
      },
      {
        title: "资金",
        items: [
          row("#外汇贷款", "[金额]", `最高 $${LOAN_MAX.toLocaleString("en-US")}，需先还清才能再借`),
          row("#外汇还款", "[金额]", "不带金额为全额还款，也可部分还"),
        ],
      },
      {
        title: "模式与战役",
        items: [
          row("#外汇模拟", "", `模拟行情（默认，每 ${sim} 秒跳动一次）`),
          row("#外汇真实", "", "真实历史汇率回放，逐日推进"),
          row("#外汇战役", "[1-4]", "列出经典战役，或进入指定战役"),
          row("#外汇下一日", "[天数]", "推进 n 个交易日，例：下一日 5"),
          row("#外汇回到起点", "", "回放退回事件发生前一天"),
          row("#外汇自动", "开|关|状态", "自动推进交易日"),
        ],
      },
    ],
    rules: [
      {
        k: "初始资金",
        v: `<i>${money(INIT_CASH)}</i>　单笔保证金最低 <i>${money(MIN_MARGIN)}</i>`,
      },
      {
        k: "风险提醒",
        v: `浮亏达保证金 <i>${(WARN_RATIO * 100).toFixed(0)}%</i> 时推送补仓建议`,
      },
      {
        k: "强制爆仓",
        v: `浮亏达 <i>${(LIQUIDATE_RATIO * 100).toFixed(0)}%</i> 爆仓，损失以保证金为限，不会击穿账户`,
      },
      {
        k: "父亲的援助",
        v: `爆仓后总权益跌破 <i>0</i>，一次性恢复至 <i>${money(FATHER_AID_CASH)}</i> 并清债`,
      },
      {
        k: "贷款日息",
        v: `≤$10k <i>0.01%</i> · ≤$50k <i>0.02%</i> · ≤$100k <i>0.03%</i> · 以上 <i>0.04%</i>`,
      },
      {
        k: "货币对",
        v: `序号 <i>1-${PAIRS.length}</i> · 代码 <i>EURUSD</i> · 名称 <i>欧元</i>，三选一`,
      },
      {
        k: "金额写法",
        v: `<i>500</i> · <i>$1,000</i> · <i>1k</i> · <i>2w</i> · <i>50%</i> · <i>max</i>`,
      },
      {
        k: "空格省略",
        v: `<i>#外汇平仓1</i> 与 <i>#外汇平仓 1</i> 等效，<i>#fx long 500 20</i> 亦可`,
      },
      { k: "切换限制", v: "切换行情模式或进入战役前，需先平掉全部持仓" },
    ],
    footer: "这是游戏，不提供真实交易；历史数据为日度参考汇率。",
  }
}

export function help() {
  const m = helpModel()
  const RULE = `━`.repeat(40)
  const lines = [
    `✦ ${m.title} · 指令表`,
    RULE,
    m.subtitle,
    `${m.aliases.slice(0, 3).join("　")}　（${m.aliases[3]}）`,
    ``,
  ]

  for (const s of m.sections) {
    const width = Math.max(...s.items.map(i => strWidth(i.cmd + " " + i.arg))) + 2
    lines.push(`【${s.title}】`)
    for (const it of s.items) {
      const left = it.arg ? `${it.cmd} ${it.arg}` : it.cmd
      lines.push(`  ${pad(left, width)}${it.desc}`)
    }
    lines.push(``)
  }

  lines.push(RULE, `【游戏规则与参数】`)
  for (const r of m.rules) lines.push(`  ${pad(r.k, 14)}${stripTags(r.v)}`)
  lines.push(``, m.footer)
  return lines.join("\n")
}
