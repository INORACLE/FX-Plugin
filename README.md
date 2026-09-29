# FX-Plugin · FX 简单! 交易室

把 [FX 简单!](https://www.bilibilitoy.com/toy/fx-simple/index.html) 搬进 Yunzai 群聊的外汇模拟交易游戏。
玩法、数值与原版对齐，展示层改为聊天文本 + ASCII 走势图。

- 初始资金 **$10,000**，杠杆 **1–100×**，风险提醒 **60%**、强制平仓 **80%**
- 7 个货币对、5 步教程、4 场历史战役
- 真实历史汇率来自 [Frankfurter](https://frankfurter.dev/)（ECB 日度参考价）
- 账户按「群 + 用户」隔离，Redis 优先，未启用时自动退回本地 JSON

## 安装

插件无外部依赖（Node 18+ 内置 `fetch`），克隆到 Yunzai 的 `plugins/` 目录后重启或热重载即可。

### 方法一：git clone

```bash
# 1. 进入 Yunzai 根目录（即含 package.json、plugins/ 的那一层）
cd /path/to/Yunzai

# 2. 克隆到 plugins/FX-Plugin
git clone https://github.com/<你的用户名>/FX-Plugin.git plugins/FX-Plugin
```

Windows 下：

```powershell
cd C:\path\to\Yunzai
git clone https://github.com/<你的用户名>/FX-Plugin.git plugins/FX-Plugin
```

### 方法二：手动下载

在仓库页面点 **Code → Download ZIP**，解压后把 `FX-Plugin` 文件夹放进 `plugins/`，
保证最终路径是 `Yunzai/plugins/FX-Plugin/index.js`。

### 方法三：更新已有安装

```bash
cd plugins/FX-Plugin
git pull
```

### 完成后

1. 重启 Yunzai，或等待插件热重载。
2. 首次启动会自动生成 `config/FX-Plugin.yaml`。
3. 在群里发一条 `#FX帮助`，收到指令表图片即安装成功。

> 提示：`#FX帮助` 需要 Yunzai 自带的图片渲染后端。
> 若渲染不可用，插件会自动退回纯文字，不影响使用。

## 指令

所有指令都可用 `#外汇` / `#fx` / `#forex` 开头，`#` 可省略，命令词与子命令之间可加空格。
参数既支持空格分隔也支持粘连：`#外汇做多 500 20` 与 `#外汇做多50020` 等价。

### 账户

| 指令 | 说明 |
| --- | --- |
| `#外汇` | 账户总览：余额、持仓、浮动盈亏、贷款、净值 |
| `#FX帮助` / `#fx帮助` | 指令表图片（大小写均可触发） |
| `#外汇教程 1` | 新手教程，参数 1–5 |
| `#外汇持仓` | 当前持仓明细 |
| `#外汇记录` | 历史成交 |
| `#外汇排行` | 群内净值榜，可带人数 `#外汇排行 20` |
| `#外汇重开 确认` | 清空账户重开 |

### 行情

| 指令 | 说明 |
| --- | --- |
| `#外汇行情` | 7 个货币对盘口 |
| `#外汇价格 3` | 单个货币对报价，参数可为序号 / 代码 / 名称 |
| `#外汇图表 3` | ASCII 走势图 |
| `#外汇切换 欧元` | 切换当前货币对 |
| `#外汇模拟` | 模拟行情（默认，每 1.5s 跳动） |
| `#外汇真实` | 真实历史汇率回放 |

### 交易

| 指令 | 说明 |
| --- | --- |
| `#外汇做多 500 20` | 开多，保证金 500、杠杆 20× |
| `#外汇做空 1000` | 开空，用默认杠杆 |
| `#外汇平仓1` | 平掉第 1 笔 |
| `#外汇平仓全部` | 全部平仓 |
| `#外汇补仓1 200` | 给第 1 笔追加现金保证金 |
| `#外汇借补1 200` | 追加贷款作为保证金 |

金额支持 `$1,000`、`1k`、`2w`、`50%`、`max` 等写法。

### 资金

| 指令 | 说明 |
| --- | --- |
| `#外汇贷款 5000` | 借款，上限 $200,000 |
| `#外汇还款` | 全部还清，或 `#外汇还款 1000` 部分还款 |

日利率分级：≤$10k 为 0.01%，≤$50k 为 0.02%，≤$100k 为 0.03%，以上 0.04%。
每个交易日自动计息。

### 战役与回放

| 指令 | 说明 |
| --- | --- |
| `#外汇战役` | 战役列表 / 当前战役进度 |
| `#外汇战役 2` | 进入第 2 场（脱欧公投） |
| `#外汇下一日` | 推进一个交易日，`#外汇下一日 5` 推进 5 天 |
| `#外汇回到起点` | 回到本场回放起点 |
| `#外汇自动 开` | 自动逐日推进，`#外汇自动 关` 停止 |

四场战役：瑞郎脱钩（2015-01-15）、脱欧公投（2016-06-23）、瑞郎二次升值（2022-09-12）、日元干预（2022-09-22）。

## 规则

- 浮亏达到保证金 **60%** 时推送补仓建议；**80%** 强制平仓，损失以保证金为限
- 爆仓后净值跌破 0 会触发一次「父亲的援助」：清空债务并恢复 $5,000，每人仅一次
- 切换模式或进入战役需要先平掉全部持仓

## 配置

`config/FX-Plugin.yaml`：

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `api` | Frankfurter v2 | 汇率接口地址 |
| `simTickMs` | 1500 | 模拟行情跳动间隔 |
| `loanDayTicks` | 20 | 多少跳算一个交易日（用于计息） |
| `autoPlayMs` | 5000 | 自动播放推进间隔 |
| `rankSize` | 10 | 排行默认条数 |
| `cacheTTL` | 6h | 历史数据缓存时长 |
| `atSender` | false | 回复是否 @ 发送者 |
| `expireDays` | 90 | 闲置账户清理天数 |

## 数据存储

优先使用 Yunzai 的 Redis，key 为 `Yz:fxplugin:acc:<群ID>:<用户ID>`。
Redis 不可用时退回 `plugins/FX-Plugin/data/accounts.json`，仅存本机，重启不丢。

## 目录结构

按 Yunzai 插件惯例：根目录 `index.js` 扫描 `apps/` 并 `export { apps }`，
由 `lib/plugins/loader.js` 收集 `apps/*` 中导出的 plugin 子类。

```
FX-Plugin/
├─ index.js          # 插件入口：扫描 apps/ 并导出 apps
├─ package.json
├─ apps/
│  └─ trade.js       # 指令规则与命令处理
├─ model/
│  ├─ constants.js    # 货币对、战役、教程、利率等常量
│  ├─ config.js       # 配置文件
│  ├─ store.js        # Redis / 文件持久化
│  ├─ market.js       # 模拟行情 + Frankfurter 拉取
│  ├─ engine.js       # 账户、开平仓、强平、贷款、战役
│  ├─ render.js       # 文本渲染与 ASCII 图表
│  └─ help-image.js   # 指令表图片渲染（失败自动回退文字）
├─ resources/
│  └─ help/index.html # 指令表图片模板（art-template）
└─ data/              # 账户存档（已 gitignore）
```

`ticker` 与行情状态挂在 `globalThis` 上，修改插件触发热重载后行情不会中断或清空。

### 指令表图片

`#FX帮助` 走 `lib/puppeteer/puppeteer.js`，用 `resources/help/index.html`
经 art-template 填入 `render.js` 的 `helpModel()` 数据后截图。
模板不含 `<script>`，因此 shotium 与 puppeteer 两个渲染后端都能处理。
任何一步失败都会自动回退为纯文字，不会让用户收不到回复。

## 开发

```bash
# 格式化（沿用 Yunzai 根目录 prettier.config.js）
npx prettier --config ../../prettier.config.js --write "FX-Plugin/**/*.js"
```
