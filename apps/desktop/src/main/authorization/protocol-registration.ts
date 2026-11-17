// 负责为发布版登记授权回跳协议，AppImage 的入口存放在用户的 XDG 应用目录。

import { execFile } from "node:child_process"
import { readFile, stat } from "node:fs/promises"
import { isAbsolute, join } from "node:path"
import { promisify } from "node:util"
import type { App } from "electron"
import { writeXdgDesktopEntry, xdgExecCommand } from "../xdg-desktop-entry"
import { privateAuthorizationScheme } from "./callback-receiver"

const run = promisify(execFile)
const desktopFile = "pigclaude-appimage.desktop"
const mimeType = "x-scheme-handler/" + privateAuthorizationScheme

/** AppImage 使用保存在磁盘上的启动路径，其余发布版沿用 Electron 的系统注册。 */
export async function registerDesktopAuthorizationProtocol(
  app: Pick<App, "isPackaged" | "getPath" | "setAsDefaultProtocolClient">,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  if (!app.isPackaged) return
  const appImage = platform === "linux" ? env["APPIMAGE"] : undefined
  if (!appImage || !isAbsolute(appImage)) {
    app.setAsDefaultProtocolClient(privateAuthorizationScheme)
    return
  }

  try {
    await registerAppImage(appImage, app.getPath("home"), env)
  } catch {
    console.error("APPIMAGE_PROTOCOL_REGISTRATION_FAILED")
  }
}

async function registerAppImage(appImage: string, home: string, env: NodeJS.ProcessEnv) {
  if ([...appImage].some((character) => character.charCodeAt(0) < 32)) {
    throw new Error("APPIMAGE_PATH_INVALID")
  }
  if (!(await stat(appImage)).isFile()) throw new Error("APPIMAGE_PATH_INVALID")

  const dataHome = env["XDG_DATA_HOME"]
  const data = dataHome && isAbsolute(dataHome) ? dataHome : join(home, ".local", "share")
  const entry = join(data, "applications", desktopFile)
  const content = [
    "[Desktop Entry]",
    "Type=Application",
    "Name=PigClaude",
    "NoDisplay=true",
    "Exec=" + xdgExecCommand(appImage, "pigclaude-appimage", "%u"),
    "MimeType=" + mimeType + ";",
    "",
  ].join("\n")
  const current = await readFile(entry, "utf8").catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null
    throw error
  })
  if (current !== content) await writeXdgDesktopEntry(entry, content)

  const options = { env: { ...env, XDG_DATA_HOME: data }, timeout: 5_000 }
  const association = await run("xdg-mime", ["query", "default", mimeType], options)
  if (association.stdout.trim() !== desktopFile) {
    await run("xdg-mime", ["default", desktopFile, mimeType], options)
  }
}
