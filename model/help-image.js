import { fileURLToPath } from "node:url"
import path from "node:path"
import puppeteer from "../../../lib/puppeteer/puppeteer.js"
import { PLUGIN_NAME } from "./constants.js"
import { help, helpModel } from "./render.js"

/** resources/help/index.html 的绝对路径 */
const TPL = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "resources",
  "help",
  "index.html",
)

/**
 * 渲染指令表为图片。
 * 任何一步失败都退回纯文字，保证 #FX帮助 永远有回复。
 */
export async function helpImage() {
  try {
    const img = await puppeteer.screenshot(PLUGIN_NAME, {
      tplFile: TPL,
      saveId: "help",
      imgType: "png",
      quality: 100,
      ...helpModel(),
    })
    if (img) return img
    logger.warn(`[${PLUGIN_NAME}] 指令表图片为空，回退文字`)
  } catch (err) {
    logger.error(`[${PLUGIN_NAME}] 指令表渲染失败，回退文字：${err?.message ?? err}`)
    logger.debug(err)
  }
  return help()
}
