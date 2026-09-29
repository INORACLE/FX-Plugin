import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { PLUGIN_NAME } from "./model/constants.js"

/** 插件根目录，基于 import.meta.url 解析，不依赖进程 cwd */
const root = path.dirname(fileURLToPath(import.meta.url))
const appsDir = path.join(root, "apps")

const apps = {}

const files = (await fs.readdir(appsDir)).filter(f => f.endsWith(".js")).sort()

for (const file of files) {
  const name = path.basename(file, ".js")
  try {
    const mod = await import(pathToFileURL(path.join(appsDir, file)).href)
    /** 只有 plugin 的子类才会被 loader 收集，实例没有 prototype */
    const App = Object.values(mod).find(
      v => typeof v === "function" && v.prototype instanceof plugin,
    )
    if (!App) {
      logger.error(`[${PLUGIN_NAME}] apps/${file} 未导出有效的 plugin 类，已跳过`)
      continue
    }
    apps[name] = App
  } catch (err) {
    logger.error(`[${PLUGIN_NAME}] 载入 apps/${file} 失败: ${err.message}`)
    logger.debug(err)
  }
}

if (!Object.keys(apps).length) logger.error(`[${PLUGIN_NAME}] 未载入到任何 app，请检查 ${appsDir}`)

export { apps }
