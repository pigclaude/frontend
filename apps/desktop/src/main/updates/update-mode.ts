// 负责决定这台机器上发现新版本后怎么更新：后台安装、下载后手动替换，或者只打开发布页。
import type { UpdateMode } from "./update-service"

/**
 * 只有安装包才能更新：Windows 和 AppImage 由 electron-updater 后台安装；macOS 不签名，下载 DMG 手动替换；
 * 开发运行和不是 AppImage 的 Linux 只打开发布页。
 */
export function updateMode(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  isPackaged: boolean,
): UpdateMode {
  if (!isPackaged) return "notify"
  if (platform === "win32") return "install"
  if (platform === "linux" && Boolean(env["APPIMAGE"])) return "install"
  if (platform === "darwin") return "replace"
  return "notify"
}
