# Changelog

本文件记录 FX-Plugin 的重要变更。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 已完成

- 适配 Yunzai 插件结构：根目录 `index.js` 扫描 `apps/` 并 `export { apps }`。
- `#FX帮助` / `#fx帮助` 改为发送指令表**图片**（大小写均可触发）。
  图片由 `resources/help/index.html` 经 art-template 渲染后截图，
  失败时自动回退为纯文字。
- 指令表数据统一由 `render.js` 的 `helpModel()` 提供，图片与文字版共用一份来源。
- 风险提醒状态（`warned`）纳入账户持久化，避免每次指令重复推送。
- `借补` 走 `borrowLoan()`，借款正确计入持仓保证金。
- 参数解析改用 `argOf()`，支持 `#外汇平仓1` 这类粘连写法。
- 行情运行时状态挂到 `globalThis[Symbol.for(...)]`，热重载后不中断。

## [1.0.0]

- 首个版本：完整的外汇模拟交易玩法。
  账户与持仓管理、保证金杠杆、风险提醒与强制平仓、
  分级计息贷款、父亲的援助、模拟与真实汇率双模式、
  4 场历史战役回放、群内账户排行。
- 账户按「群 + 用户」隔离，Redis 优先，未启用时退回本地 JSON。
