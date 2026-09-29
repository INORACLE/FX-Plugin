import config from "../model/config.js"
import { BATTLES, LOAN_MAX, battleOf, pairOf, rateText, resolvePair } from "../model/constants.js"
import {
  account,
  addMarginTo,
  borrowLoan,
  closeByIndex,
  initialState,
  nextDay,
  openPosition,
  parseAmount,
  positionPnl,
  refresh,
  repayLoan,
  replaySeries,
  setMode,
  startBattle,
  view,
} from "../model/engine.js"
import { priceText, seedSim, tickSim } from "../model/market.js"
import { delAccount, getAccount, gc, listAccounts, setAccount, storeMode } from "../model/store.js"
import {
  accountPanel,
  battleBrief,
  battleList,
  chart,
  help,
  helpModel,
  money,
  pairList,
  positions,
  pct,
  signedMoney,
  tradeLog,
  tutorial,
} from "../model/render.js"
import { helpImage } from "../model/help-image.js"

/** 跨热重载共享的运行时 */
const RT = Symbol.for("FX-Plugin.runtime")
const rt = (globalThis[RT] ??= { timer: null, gcTimer: null, auto: new Map() })

const autoKey = (gid, uid) => `${gid}:${uid}`
const DAY_MS = Math.max(2000, Number(config.autoPlayMs) || 5000)

function startTicker() {
  if (rt.timer) return
  seedSim()
  rt.timer = setInterval(
    () => {
      try {
        tickSim()
      } catch (err) {
        logger.error("[FX] 行情推进出错", err)
      }
      void runAuto()
    },
    Math.max(500, Number(config.simTickMs) || 1500),
  )
  rt.timer.unref?.()
}

/** 自动播放：到点替玩家推进一个交易日 */
async function runAuto() {
  if (!rt.auto.size) return
  const now = Date.now()
  for (const [key, item] of [...rt.auto]) {
    if (now - item.at < DAY_MS) continue
    item.at = now
    try {
      const raw = await getAccount(item.gid, item.uid)
      if (!raw) {
        rt.auto.delete(key)
        continue
      }
      const { state, view: v } = refresh(raw)
      const res = nextDay(state, v)
      if (!res.ok) {
        rt.auto.delete(key)
        continue
      }
      const after = refresh(state)
      await setAccount(item.gid, item.uid, after.state)
      const lines = [
        `⏩ ${item.name} 自动推进到 ${after.view.date} · 权益 ${money(account(after.state, after.view).equity)}`,
        ...after.events,
      ]
      await push(item, lines.join("\n"))
    } catch (err) {
      logger.error("[FX] 自动播放失败", err)
      rt.auto.delete(key)
    }
  }
}

async function push(item, text) {
  try {
    if (item.group_id) await Bot.sendGroupMsg(item.self_id, item.group_id, text)
    else await Bot.sendFriendMsg(item.self_id, item.user_id, text)
  } catch (err) {
    logger.error("[FX] 自动播放推送失败", err)
  }
}

/**
 * 取出子命令之后的参数，兼容 `#外汇补仓1 200`（粘连）与 `#外汇补仓 1 200`（空格）
 * kw 为子命令关键字的正则片段，返回 [参数1, 参数2]
 */
const argOf = (e, kw) => {
  const m = String(e.msg ?? "").match(new RegExp(`${kw}\\s*(\\S+)?(?:\\s+(\\S+))?\\s*$`, "i"))
  return [m?.[1], m?.[2]]
}

export class FxGame extends plugin {
  constructor() {
    super({
      name: "FX-Plugin",
      dsc: "FX 简单! 外汇模拟交易游戏（数据源 Frankfurter）",
      event: "message",
      priority: 5000,
      rule: [
        { reg: /^#?\s*(外汇|fx|forex)\s*(帮助|help|菜单|指令|说明)$/i, fnc: "onHelp" },
        {
          reg: /^#?\s*(外汇|fx|forex)\s*(重开|重置|重来|重新开始|reset)\s*(确认|confirm|确定)$/i,
          fnc: "onReset",
        },
        { reg: /^#?\s*(外汇|fx|forex)\s*(重开|重置|重来|重新开始|reset)$/i, fnc: "onResetAsk" },
        {
          reg: /^#?\s*(外汇|fx|forex)\s*(教程|教学|新手|tutorial)\s*(\d{1,2})?$/i,
          fnc: "onTutorial",
        },
        { reg: /^#?\s*(外汇|fx|forex)\s*(排行|排名|榜单|榜|rank)\s*(\d{1,2})?$/i, fnc: "onRank" },
        { reg: /^#?\s*(外汇|fx|forex)\s*(记录|历史|日志|流水|history|log)$/i, fnc: "onHistory" },
        { reg: /^#?\s*(外汇|fx|forex)\s*(持仓|仓位|未平仓|positions?)$/i, fnc: "onPositions" },
        {
          reg: /^#?\s*(外汇|fx|forex)\s*(平仓|结算|close)\s*(全部|all|\d+|最后|last)?$/i,
          fnc: "onClose",
        },
        {
          reg: /^#?\s*(外汇|fx|forex)\s*(借补|借款补仓|贷款补仓)\s*(\d+)?(?:\s+(\S+))?$/i,
          fnc: "onLoanMargin",
        },
        {
          reg: /^#?\s*(外汇|fx|forex)\s*(补仓|加保证金|追加)\s*(\d+)?(?:\s+(\S+))?$/i,
          fnc: "onAddMargin",
        },
        { reg: /^#?\s*(外汇|fx|forex)\s*(贷款|借款|借贷|借钱|borrow)\s*(\S+)?$/i, fnc: "onBorrow" },
        { reg: /^#?\s*(外汇|fx|forex)\s*(还款|还贷|还钱|repay)\s*(\S+)?$/i, fnc: "onRepay" },
        {
          reg: /^#?\s*(外汇|fx|forex)\s*(做多|多|买|long|buy)\s*(\S+)?(?:\s+(\S+))?$/i,
          fnc: "onLong",
        },
        {
          reg: /^#?\s*(外汇|fx|forex)\s*(做空|空|卖|short|sell)\s*(\S+)?(?:\s+(\S+))?$/i,
          fnc: "onShort",
        },
        {
          reg: /^#?\s*(外汇|fx|forex)\s*(下一日|下一交易日|次日|推进|next)\s*(\d{1,3})?$/i,
          fnc: "onNextDay",
        },
        { reg: /^#?\s*(外汇|fx|forex)\s*(回到起点|重播|回起点|replay)$/i, fnc: "onReplay" },
        { reg: /^#?\s*(外汇|fx|forex)\s*(自动|auto)\s*(\S+)?$/i, fnc: "onAuto" },
        { reg: /^#?\s*(外汇|fx|forex)\s*(战役|战斗|battle)\s*(\S+)?$/i, fnc: "onBattle" },
        { reg: /^#?\s*(外汇|fx|forex)\s*(真实|历史行情|real)$/i, fnc: "onReal" },
        { reg: /^#?\s*(外汇|fx|forex)\s*(模拟|模拟行情|sim)$/i, fnc: "onSim" },
        { reg: /^#?\s*(外汇|fx|forex)\s*(图表|走势|曲线|k线|chart)\s*(\S+)?$/i, fnc: "onChart" },
        { reg: /^#?\s*(外汇|fx|forex)\s*(行情|报价|市场|盘口|quotes?|market)$/i, fnc: "onQuotes" },
        { reg: /^#?\s*(外汇|fx|forex)\s*(切换|选择|选|select|pair)\s+(\S+)$/i, fnc: "onSelect" },
        { reg: /^#?\s*(外汇|fx|forex)\s*(切换|选择|选|select|pair)$/i, fnc: "onSelect" },
        { reg: /^#?\s*(外汇|fx|forex)\s*(价格|报价单|price)\s*(\S+)?$/i, fnc: "onPrice" },
        { reg: /^#?\s*(外汇|fx|forex)\s*$/i, fnc: "onOverview" },
      ],
    })
  }

  async init() {
    startTicker()
    if (!rt.gcTimer) {
      rt.gcTimer = setInterval(() => void gc().catch(() => {}), 6 * 3600 * 1000)
      rt.gcTimer.unref?.()
    }
    logger.mark(`[FX] FX 简单! 已就绪 · 存储 ${storeMode()}`)
  }

  /* ---------------- 基础设施 ---------------- */

  get gid() {
    return this.e.isGroup ? String(this.e.group_id) : "private"
  }

  get uid() {
    return String(this.e.user_id)
  }

  get uname() {
    return this.e.sender?.card || this.e.sender?.nickname || this.e.user_name || this.uid
  }

  /** 读档 + 结算到期事件（利息 / 爆仓 / 补仓提醒） */
  async load() {
    const raw = await getAccount(this.gid, this.uid)
    return { ...refresh(raw), fresh: !raw }
  }

  async save(state) {
    state.name = this.uname
    return setAccount(this.gid, this.uid, state)
  }

  async say(events, text) {
    const body = events?.length ? `${events.join("\n")}\n${text}` : text
    return this.reply(body, true, { at: config.atSender })
  }

  /** 首次进来自动开户 */
  async onboarding({ state, fresh }) {
    if (!fresh) return false
    await this.save(state)
    await this.say(
      [],
      [
        "✦ 欢迎来到 FX 简单! 交易室",
        "━━━━━━━━━━━━━━━",
        `已为你开户，初始资金 ${money(state.cash)}`,
        "",
        "先看 #外汇教程 1，或直接 #外汇做多 500 20",
        "#外汇行情 查看盘口 · #外汇帮助 查看全部指令",
      ].join("\n"),
    )
    return true
  }

  /* ---------------- 账户 ---------------- */

  async onOverview() {
    const c = await this.load()
    if (await this.onboarding(c)) return
    return this.say(c.events, accountPanel(c.state, c.view))
  }

  async onHelp() {
    return this.reply(await helpImage(), true)
  }

  async onTutorial(e) {
    return this.reply(tutorial(argOf(e, "(?:教程|教学|新手|tutorial)")[0]), true)
  }

  async onResetAsk() {
    return this.reply(
      "重开会把余额、持仓、贷款和记录全部清空，确定吗？\n确认请发送：#外汇重开 确认",
      true,
    )
  }

  async onReset() {
    await delAccount(this.gid, this.uid)
    rt.auto.delete(autoKey(this.gid, this.uid))
    const state = initialState()
    await this.save(state)
    return this.reply(`新的一局开始了，账户已重置为 ${money(state.cash)}。`, true)
  }

  /* ---------------- 行情 ---------------- */

  async onQuotes() {
    const c = await this.load()
    if (await this.onboarding(c)) return
    return this.say(c.events, pairList(c.state, c.view))
  }

  async onChart(e) {
    const c = await this.load()
    if (await this.onboarding(c)) return
    const pair = resolvePair(argOf(e, "(?:图表|走势|曲线|k线|chart)")[0]) || c.state.pair
    const head = `【${pair}】${pairOf(pair)?.name ?? ""} 现价 ${priceText(pair, c.view.priceOf(pair))}`
    return this.say(c.events, `${head}\n${chart(c.state, c.view, pair)}`)
  }

  async onPrice(e) {
    const c = await this.load()
    if (await this.onboarding(c)) return
    const arg = argOf(e, "(?:价格|报价单|price)")[0]
    if (!arg) return this.say(c.events, pairList(c.state, c.view))
    const pair = resolvePair(arg)
    if (!pair)
      return this.reply(
        "没认出这个货币对。可以填序号 1-7 或代码，例如 #外汇价格 3、#外汇价格 usdjpy",
        true,
      )
    const price = c.view.priceOf(pair)
    const prev = c.view.previousOf(pair)
    return this.say(
      c.events,
      [
        `${pair} ${pairOf(pair).name}`,
        `现价 ${priceText(pair, price)}  ${pct(prev ? (price / prev - 1) * 100 : 0)}`,
        `查看走势 #外汇图表 ${pair}`,
      ].join("\n"),
    )
  }

  async onSelect(e) {
    const c = await this.load()
    if (await this.onboarding(c)) return
    const arg = argOf(e, "(?:切换|选择|选|select|pair)")[0]
    if (!arg) return this.say(c.events, pairList(c.state, c.view))
    const pair = resolvePair(arg)
    if (!pair) return this.reply("没认出这个货币对，发送 #外汇行情 查看可选的 7 个货币对。", true)
    c.state.pair = pair
    await this.save(c.state)
    const after = refresh(c.state)
    await this.save(after.state)
    return this.say(
      c.events,
      [
        `已切换到 ${pair} ${pairOf(pair).name}  现价 ${priceText(pair, after.view.priceOf(pair))}`,
        chart(after.state, after.view, pair),
      ].join("\n"),
    )
  }

  /* ---------------- 交易 ---------------- */

  async trade(side, marginArg, levArg) {
    const c = await this.load()
    if (await this.onboarding(c)) return
    const { state } = c
    const margin = marginArg ? parseAmount(marginArg, state.cash) : state.margin
    if (margin === null) return this.reply("保证金格式不对，例如 #外汇做多 500 20", true)
    const leverage = levArg ? Number(levArg) : state.leverage
    if (levArg && (!Number.isInteger(leverage) || leverage < 1 || leverage > 100))
      return this.reply("杠杆需要是 1-100 之间的整数，例如 #外汇做多 500 20", true)

    const res = openPosition(state, c.view, { side, margin, leverage })
    if (!res.ok) return this.say(c.events, `✕ ${res.msg}`)
    const pos = res.pos
    const after = refresh(state)
    await this.save(after.state)
    return this.say(
      c.events,
      [
        `✓ ${pos.pair} ${side === 1 ? "做多" : "做空"}开仓成功`,
        `开仓价 ${priceText(pos.pair, pos.entry)} · 保证金 ${money(pos.margin)} · ${pos.leverage}×`,
        `名义仓位 ${money(pos.notional)} · 可承受反向波动 ${(80 / pos.leverage).toFixed(2)}%`,
        `剩余可用余额 ${money(after.state.cash)}`,
      ].join("\n"),
    )
  }

  async onLong(e) {
    const [margin, lev] = argOf(e, "(?:做多|多|买|long|buy)")
    return this.trade(1, margin, lev)
  }

  async onShort(e) {
    const [margin, lev] = argOf(e, "(?:做空|空|卖|short|sell)")
    return this.trade(-1, margin, lev)
  }

  async onPositions() {
    const c = await this.load()
    if (await this.onboarding(c)) return
    return this.say(c.events, positions(c.state, c.view))
  }

  async onClose(e) {
    const c = await this.load()
    if (await this.onboarding(c)) return
    const token = argOf(e, "(?:平仓|结算|close)")[0]
    if (!token) return this.say(c.events, positions(c.state, c.view))
    const res = closeByIndex(c.state, c.view, token)
    if (!res.ok) return this.say(c.events, `✕ ${res.msg}`)
    const after = refresh(c.state)
    await this.save(after.state)
    const head = res.all
      ? `✓ 已平掉全部 ${res.count} 笔持仓，合计盈亏 ${signedMoney(res.pnl)}`
      : [
          `✓ 已平掉 ${res.pos.pair} ${res.pos.side === 1 ? "做多" : "做空"}`,
          `开仓 ${priceText(res.pos.pair, res.pos.entry)} → 平仓 ${priceText(res.pos.pair, c.view.priceOf(res.pos.pair))}`,
          `本次盈亏 ${signedMoney(res.pnl)}`,
        ].join("\n")
    return this.say(
      [...c.events, ...after.events],
      `${head}\n账户总权益 ${money(account(after.state, after.view).equity)}`,
    )
  }

  async onHistory() {
    const c = await this.load()
    if (await this.onboarding(c)) return
    return this.say(c.events, tradeLog(c.state))
  }

  /* ---------------- 资金 ---------------- */

  async onBorrow(e) {
    const c = await this.load()
    if (await this.onboarding(c)) return
    const { state } = c
    if (state.debt > 0)
      return this.say(c.events, `当前还有 ${money(state.debt)} 未还，先 #外汇还款。`)
    const arg = argOf(e, "(?:贷款|借款|借贷|借钱|borrow)")[0]
    if (!arg)
      return this.reply(
        [
          `要借多少？最多 ${money(LOAN_MAX)}，例如 #外汇贷款 5000`,
          "日利率：≤$10,000 为 0.01%，≤$50,000 为 0.02%，≤$100,000 为 0.03%，以上 0.04%。",
        ].join("\n"),
        true,
      )
    const amount = parseAmount(arg, LOAN_MAX)
    if (amount === null)
      return this.reply("金额格式不对，例如 #外汇贷款 5000 或 #外汇贷款 1w", true)
    const res = borrowLoan(state, amount)
    if (!res.ok) return this.say(c.events, `✕ ${res.msg}`)
    await this.save(state)
    return this.say(
      c.events,
      [
        `✓ 已借入 ${money(amount)}，日利率 ${rateText(state.loanRate)}`,
        `可用余额 ${money(state.cash)}`,
        `每个交易日自动计息；模拟行情约每 ${((config.simTickMs * config.loanDayTicks) / 1000).toFixed(0)} 秒算一天。`,
      ].join("\n"),
    )
  }

  async onRepay(e) {
    const c = await this.load()
    if (await this.onboarding(c)) return
    const { state } = c
    const arg = argOf(e, "(?:还款|还贷|还钱|repay)")[0]
    const amount = arg ? parseAmount(arg, state.debt) : state.debt
    if (arg && amount === null) return this.reply("金额格式不对，例如 #外汇还款 1000", true)
    const res = repayLoan(state, amount ?? undefined)
    if (!res.ok) return this.say(c.events, `✕ ${res.msg}`)
    await this.save(state)
    return this.say(
      c.events,
      `✓ 已偿还 ${money(res.amount)}\n剩余待还 ${money(state.debt)} · 可用余额 ${money(state.cash)}`,
    )
  }

  async marginCmd(e, borrow) {
    const c = await this.load()
    if (await this.onboarding(c)) return
    const { state } = c
    if (!state.positions.length) return this.say(c.events, "当前没有持仓，先 #外汇做多 开一笔。")
    const [idxTok, amtTok] = argOf(
      e,
      borrow ? "(?:借补|借款补仓|贷款补仓)" : "(?:补仓|加保证金|追加)",
    )
    if (!idxTok) return this.say(c.events, positions(state, c.view))
    const idx = Number.parseInt(idxTok, 10)
    if (!Number.isInteger(idx) || idx < 1 || idx > state.positions.length)
      return this.reply("序号不存在，发送 #外汇持仓 查看当前持仓。", true)
    const ceiling = borrow ? LOAN_MAX : state.cash
    const amount = amtTok ? parseAmount(amtTok, ceiling) : state.cash * 0.5
    if (amount === null || amount < 1)
      return this.reply(
        `补仓金额格式不对，例如 ${borrow ? "#外汇借补1 200" : "#外汇补仓1 200"}`,
        true,
      )

    const pos = state.positions[idx - 1]
    const res = addMarginTo(state, pos, amount, borrow)
    if (!res.ok) return this.say(c.events, `✕ ${res.msg}`)
    pos.warned = false
    const after = refresh(state)
    await this.save(after.state)
    const pnl = positionPnl(pos, after.view)
    return this.say(
      c.events,
      [
        `✓ ${borrow ? "已借款" : "已追加"} ${money(amount)} 到 ${pos.pair} 保证金`,
        `新保证金 ${money(pos.margin)} · 当前盈亏 ${signedMoney(pnl)}（${pct((pnl / pos.margin) * 100)}）`,
        `剩余可用余额 ${money(after.state.cash)}${state.debt > 0 ? ` · 待还 ${money(state.debt)}` : ""}`,
      ].join("\n"),
    )
  }

  async onAddMargin(e) {
    return this.marginCmd(e, false)
  }

  async onLoanMargin(e) {
    return this.marginCmd(e, true)
  }

  /* ---------------- 模式 ---------------- */

  async onSim() {
    const c = await this.load()
    if (await this.onboarding(c)) return
    if (c.state.mode !== "sim") {
      const res = await setMode(c.state, "sim")
      if (!res.ok) return this.say(c.events, `✕ ${res.msg}`)
    }
    rt.auto.delete(autoKey(this.gid, this.uid))
    const after = refresh(c.state)
    await this.save(after.state)
    return this.say(
      c.events,
      `✓ 模拟行情，每 ${(config.simTickMs / 1000).toFixed(1)} 秒跳动一次\n${accountPanel(after.state, after.view)}`,
    )
  }

  async onReal() {
    const c = await this.load()
    if (await this.onboarding(c)) return
    if (c.state.mode === "real")
      return this.say(
        c.events,
        `已在真实历史数据模式：${c.view.date}（第 ${c.view.index + 1}/${c.view.total} 个交易日）\n用 #外汇下一日 推进。`,
      )
    const res = await setMode(c.state, "real")
    if (!res.ok) return this.say(c.events, `✕ ${res.msg}`)
    const after = refresh(c.state)
    await this.save(after.state)
    const v = after.view
    return this.say(
      c.events,
      [
        "✓ 已切换为真实历史汇率回放（Frankfurter 日度参考价）",
        `${v.date} · 第 ${v.index + 1} / ${v.total} 个交易日`,
        chart(after.state, v, after.state.pair),
        "用 #外汇下一日 逐日推进。",
      ].join("\n"),
    )
  }

  async onBattle(e) {
    const c = await this.load()
    if (await this.onboarding(c)) return
    const arg = argOf(e, "(?:战役|战斗|battle)")[0]
    if (!arg) {
      if (c.state.mode === "battle" && c.state.battleId) {
        const meta = battleOf(c.state.battleId)
        return this.say(
          c.events,
          [
            battleBrief(meta),
            `进度 ${c.view.index + 1}/${c.view.total} · 当前 ${c.view.date}`,
            chart(c.state, c.view, c.state.pair),
          ].join("\n"),
        )
      }
      return this.say(c.events, battleList())
    }
    const idx = Number.parseInt(arg, 10)
    const meta = Number.isInteger(idx) ? BATTLES[idx - 1] : battleOf(String(arg).toLowerCase())
    if (!meta) return this.reply("没有这场战役，发送 #外汇战役 查看列表。", true)
    const res = await startBattle(c.state, meta.id)
    if (!res.ok) return this.say(c.events, `✕ ${res.msg}`)
    const after = refresh(c.state)
    await this.save(after.state)
    return this.say(
      c.events,
      [
        `⚔ ${meta.title} 已就绪${res.resumed ? "（继续上次进度）" : "，从事件前一天开始回放"}`,
        battleBrief(meta),
        `进度 ${after.view.index + 1}/${after.view.total} · 当前 ${after.view.date}`,
        chart(after.state, after.view, after.state.pair),
        `事件日是 ${meta.event}，用 #外汇下一日 推进过去。`,
      ].join("\n"),
    )
  }

  async onNextDay(e) {
    const c = await this.load()
    if (await this.onboarding(c)) return
    const times = Number(argOf(e, "(?:下一日|下一交易日|次日|推进|next)")[0] ?? 1)
    const res = nextDay(c.state, c.view, Number.isFinite(times) && times > 0 ? times : 1)
    if (!res.ok) return this.say(c.events, `✕ ${res.msg}`)
    const after = refresh(c.state)
    await this.save(after.state)
    const v = after.view
    const acc = account(after.state, v)
    const parts = [
      `⏩ 推进 ${res.days} 个交易日 → ${v.date}（第 ${v.index + 1}/${v.total} 个）`,
      `账户总权益 ${money(acc.equity)} · 浮动盈亏 ${signedMoney(acc.floating)}`,
    ]
    if (after.state.debt > 0) parts.push(`待还贷款 ${money(after.state.debt)}`)
    parts.push(chart(after.state, v, after.state.pair))
    if (v.index >= v.total - 1) {
      rt.auto.delete(autoKey(this.gid, this.uid))
      parts.push(
        v.kind === "battle"
          ? "这场战役回放结束，平掉持仓后可以选择下一场。"
          : "已经到达最新可用交易日。",
      )
    }
    return this.say([...c.events, ...after.events], parts.join("\n"))
  }

  async onReplay() {
    const c = await this.load()
    if (await this.onboarding(c)) return
    const res = replaySeries(c.state)
    if (!res.ok) return this.say(c.events, `✕ ${res.msg}`)
    const after = refresh(c.state)
    await this.save(after.state)
    return this.say(
      c.events,
      `✓ 已回到回放起点：${after.view.date}（第 ${after.view.index + 1}/${after.view.total} 个交易日）`,
    )
  }

  async onAuto(e) {
    const c = await this.load()
    if (await this.onboarding(c)) return
    const key = autoKey(this.gid, this.uid)
    const arg = (argOf(e, "(?:自动|auto)")[0] ?? "").toLowerCase()
    if (c.state.mode === "sim")
      return this.say(c.events, "自动播放用于历史回放，请先 #外汇真实 或 #外汇战役。")
    if (/^(关|off|stop|false|0|取消)$/.test(arg)) {
      rt.auto.delete(key)
      return this.say(c.events, "已关闭自动播放。")
    }
    if (/^(状态|status)$/.test(arg))
      return this.say(
        c.events,
        rt.auto.has(key)
          ? `自动播放已开启，每 ${(DAY_MS / 1000).toFixed(0)} 秒推进一个交易日。`
          : "自动播放未开启，发送 #外汇自动 开。",
      )
    if (!rt.auto.has(key) && /^关$/.test(arg)) return this.say(c.events, "已关闭自动播放。")
    if (rt.auto.has(key)) {
      rt.auto.delete(key)
      return this.say(c.events, "已关闭自动播放。")
    }
    rt.auto.set(key, {
      at: Date.now(),
      gid: this.gid,
      uid: this.uid,
      self_id: this.e.self_id,
      group_id: this.e.isGroup ? this.e.group_id : null,
      user_id: this.e.user_id,
      name: this.uname,
    })
    return this.say(
      c.events,
      `⏩ 自动播放已开启，每 ${(DAY_MS / 1000).toFixed(0)} 秒推进一个交易日\n关闭请发送 #外汇自动 关`,
    )
  }

  /* ---------------- 排行 ---------------- */

  async onRank(e) {
    const list = await this.buildRank(this.gid)
    if (!list.length) return this.reply("这个群里还没有人开户，发送 #外汇 即可开户。", true)
    const asked = Number(argOf(e, "(?:排行|排名|榜单|榜|rank)")[0])
    const size = Math.max(
      1,
      Math.min(50, Number.isFinite(asked) && asked > 0 ? asked : config.rankSize || 10),
    )
    const medal = ["🥇", "🥈", "🥉"]
    const lines = ["✦ FX 交易室 · 账户总权益排行", "━".repeat(30)]
    list.slice(0, size).forEach((it, i) => {
      lines.push(
        `${medal[i] ?? `${i + 1}.`} ${it.name}  ${money(it.equity)}${it.uid === this.uid ? "  ← 你" : ""}\n` +
          `   持仓 ${it.count} · 浮盈 ${signedMoney(it.floating)}${it.debt > 0 ? ` · 负债 ${money(it.debt)}` : ""}`,
      )
    })
    lines.push("━".repeat(30))
    const me = list.findIndex(it => it.uid === this.uid)
    if (me >= size) lines.push(`你目前排第 ${me + 1} 名 · ${money(list[me].equity)}`)
    return this.reply(lines.join("\n"), true)
  }

  async buildRank(gid) {
    const all = await listAccounts(gid)
    const out = []
    for (const { uid, data } of all) {
      const { state } = refresh(data)
      const a = account(state, view(state))
      out.push({
        uid,
        name: data?.name || uid,
        equity: a.equity,
        floating: a.floating,
        debt: state.debt,
        count: state.positions.length,
      })
    }
    return out.sort((x, y) => y.equity - x.equity)
  }
}
