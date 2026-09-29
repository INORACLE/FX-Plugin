/**
 * FX 简单! · 交易室
 * 复刻 bilibili《FX 简单!》全部数值与规则，数据源 Frankfurter
 */

/** 插件名，需与 index.js 里的调用方保持一致 */
export const PLUGIN_NAME = "FX-Plugin"

/** 货币对：与原版 initial / digits 完全一致 */
export const PAIRS = [
  { id: "EUR/USD", name: "欧元 / 美元", initial: 1.08742, digits: 5 },
  { id: "GBP/USD", name: "英镑 / 美元", initial: 1.27486, digits: 5 },
  { id: "USD/JPY", name: "美元 / 日元", initial: 149.382, digits: 3 },
  { id: "USD/CHF", name: "美元 / 瑞郎", initial: 0.88521, digits: 5 },
  { id: "EUR/CHF", name: "欧元 / 瑞郎", initial: 0.9417, digits: 5 },
  { id: "AUD/USD", name: "澳元 / 美元", initial: 0.65432, digits: 5 },
  { id: "USD/CAD", name: "美元 / 加元", initial: 1.37185, digits: 5 },
]

/** 经典战役 */
export const BATTLES = [
  {
    id: "franc-2015",
    title: "瑞郎脱钩黑天鹅",
    pair: "EUR/CHF",
    event: "2015-01-15",
    start: "2014-12-01",
    end: "2015-02-20",
    description: "瑞士央行取消欧元兑瑞郎的最低汇率。",
    source: "https://www.snb.ch/en/publications/communication/press-releases/2015/pre_20150115",
  },
  {
    id: "brexit-2016",
    title: "英国公投冲击",
    pair: "GBP/USD",
    event: "2016-06-24",
    start: "2016-05-16",
    end: "2016-07-22",
    description: "英国脱欧公投结果公布后，英镑快速下跌。",
    source: "https://www.bankofengland.co.uk/financial-stability-report/2016/july-2016",
  },
  {
    id: "parity-2022",
    title: "欧元接近平价",
    pair: "EUR/USD",
    event: "2022-07-12",
    start: "2022-06-01",
    end: "2022-08-12",
    description: "美元走强，欧元兑美元逼近平价。",
    source: "https://www.ecb.europa.eu/press/economic-bulletin/html/eb202205.en.html",
  },
  {
    id: "yen-2022",
    title: "日元干预时刻",
    pair: "USD/JPY",
    event: "2022-09-22",
    start: "2022-08-15",
    end: "2022-10-28",
    description: "日本当局买入日元，美元兑日元经历震荡。",
    source: "https://www.boj.or.jp/en/research/brp/mor/data/mor230908.pdf",
  },
]

/** 新手教程：文案与原版一致 */
export const TUTORIAL = [
  {
    icon: "↗",
    title: "做多：期待价格上涨",
    text: "选择货币对后发送 #外汇做多。如果之后的价格高于开仓价，你的仓位就会盈利；如果跌了，就会亏损。",
    example: "例：EUR/USD 从 1.0800 涨到 1.0900，做多方向有利。",
  },
  {
    icon: "↘",
    title: "做空：期待价格下跌",
    text: "发送 #外汇做空，价格下跌时盈利，价格上涨时亏损。做空和做多都可以用 #外汇平仓 结算。",
    example: "例：GBP/USD 从 1.2800 跌到 1.2700，做空方向有利。",
  },
  {
    icon: "$",
    title: "保证金：先放入押金",
    text: "开仓时投入的金额是保证金，会从可用余额暂时锁定。平仓后，剩余保证金与盈亏一起返回账户。",
    example: "例：投入 $500 保证金后，可用余额会先减少 $500。",
  },
  {
    icon: "×",
    title: "杠杆：放大波动",
    text: "杠杆会放大交易仓位，也同样放大盈利和亏损。20 倍杠杆下，约 4% 的反向价格波动就会触及本游戏的爆仓线。",
    example: "例：$500 保证金 × 20 倍杠杆 = $10,000 名义仓位。",
  },
  {
    icon: "♡",
    title: "平仓：给交易画句号",
    text: "#外汇持仓 会显示实时盈亏。发送 #外汇平仓N 按当前价格结算；若亏损达到保证金的 80%，系统会自动爆仓。",
    example: "临近爆仓时可以 #外汇补仓 追加保证金，也能 #外汇借补 借款直接补仓。",
  },
]

/** 爆仓线：亏损达到保证金的 80% */
export const LIQUIDATE_RATIO = 0.8
/** 风险提醒线：亏损达到保证金的 60% */
export const WARN_RATIO = 0.6
/** 补仓建议目标：亏损回到 55% 以内 */
export const RESCUE_RATIO = 0.55
/** 单笔最低保证金 */
export const MIN_MARGIN = 10
/** 贷款上限 */
export const LOAN_MAX = 200000
/** 初始资金 / 爆仓兜底资金 */
export const INIT_CASH = 10000
export const FATHER_AID_CASH = 5000

/** 分级日利率，与原版一致 */
export const loanDailyRate = amount =>
  amount <= 10000 ? 0.0001 : amount <= 50000 ? 0.0002 : amount <= 100000 ? 0.0003 : 0.0004

export const rateText = rate => `${(rate * 100).toFixed(2)}%`

export const pairOf = id => PAIRS.find(p => p.id === id)

export const digitsOf = id => pairOf(id)?.digits ?? 5

/** 把 "eurusd" / "1" / "欧元美元" 之类的输入解析成货币对 */
const ALIAS = new Map()
PAIRS.forEach((p, i) => {
  const flat = p.id.replace("/", "")
  ALIAS.set(flat.toUpperCase(), p.id)
  ALIAS.set(String(i + 1), p.id)
  ALIAS.set(p.id, p.id)
  const [base, quote] = p.id.split("/")
  ALIAS.set(base, p.id)
  ALIAS.set(quote, p.id)
  // 中文简称
  const zh = p.name.replace(/\s*\/\s*/g, "")
  ALIAS.set(zh, p.id)
  ALIAS.set(base + quote, p.id)
})

export function resolvePair(input) {
  if (!input) return null
  const raw = String(input).trim()
  if (!raw) return null
  if (ALIAS.has(raw)) return ALIAS.get(raw)
  const flat = raw.replace(/[\/\s_-]/g, "").toUpperCase()
  if (ALIAS.has(flat)) return ALIAS.get(flat)
  // 反向查找：输入 "美元欧元" 之类
  for (const p of PAIRS) {
    if (p.name.includes(raw) || raw.includes(p.name.replace(/\s*\/\s*/g, ""))) return p.id
  }
  return null
}

export const battleOf = id => BATTLES.find(b => b.id === id)
