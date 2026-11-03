// 打包前检查目标系统和架构的浏览器及 Xray 文件已按约定放入暂存目录。

const { stat } = require("node:fs/promises")
const { join } = require("node:path")

module.exports = async function verifyRuntimeResources(context) {
  const platform = context.electronPlatformName
  const arch = { 1: "x64", 3: "arm64" }[context.arch]
  if (!["darwin", "win32", "linux"].includes(platform) || arch === undefined) {
    throw new Error("不支持当前安装包的系统或 CPU 架构")
  }
  const root = join(context.packager.projectDir, "runtime-assets", "pigclaude-runtime")
  const browserDirectory = join(root, "chromium", `${platform}-${arch}`)
  const browser =
    platform === "darwin"
      ? join(browserDirectory, "fingerprint-chromium.app", "Contents", "MacOS", "Chromium")
      : join(browserDirectory, platform === "win32" ? "chrome.exe" : "chrome")
  const xray = join(root, "xray", `${platform}-${arch}`, platform === "win32" ? "xray.exe" : "xray")
  try {
    const files = await Promise.all([stat(browser), stat(xray)])
    if (files.every((file) => file.isFile())) return
  } catch {
    // 缺少文件时统一返回可操作的打包错误。
  }
  throw new Error(`缺少 ${platform}-${arch} 浏览器或 Xray 资源，请先准备完整发行包`)
}
