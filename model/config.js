import makeConfig from "../../../lib/plugins/config.js"

const { config } = await makeConfig("FX-Plugin", {
  /** 模拟行情每个 tick 的间隔(ms)，原版为 1500。想更慢节奏可调大 */
  simTickMs: 1500,
  /** 模拟模式多少个 tick 算一个「交易日」(原版 20 个 tick = 30 秒) */
  loanDayTicks: 20,
  /** 自动播放时每隔多少 ms 推进一个交易日 */
  autoPlayMs: 5000,
  /** 排行榜显示条数 */
  rankSize: 10,
  /** 账户闲置多少天后清理(天)，0 表示永不清理 */
  expireDays: 90,
  /** 回复时是否 @ 触发者 */
  atSender: false,
  /** 是否在冷却时间内仍然响应(遵守框架 singleCD/groupCD) */
  quiet: false,
  /** Frankfurter 接口 */
  api: "https://api.frankfurter.dev/v2",
  /** 请求超时(ms) */
  timeout: 20000,
  /** 历史数据缓存时长(ms) */
  cacheTTL: 6 * 3600 * 1000,
})

export default config
