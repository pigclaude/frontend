// 负责登记、迁移和移除本用户的 XDG 自启入口及其启动脚本。

import { readFile, rm } from "node:fs/promises"
import { isAbsolute, join } from "node:path"
import { writeXdgFile, xdgExecCommand, xdgLauncherScript } from "./xdg-desktop-entry"

/** 为 PigClaude 的固定桌面入口读写自动启动状态，不执行入口中的命令。 */
export function createXdgAutostart(
  home: string,
  configHome: string | undefined,
  executable: string,
  backgroundArg: string,
) {
  const config = configHome && isAbsolute(configHome) ? configHome : join(home, ".config")
  const directory = join(config, "autostart")
  const filePath = join(directory, "pigclaude-autostart.desktop")
  const launcherName = "pigclaude-autostart.sh"
  const launcherPath = join(directory, launcherName)
  const command = "/bin/sh ./" + launcherName + " " + backgroundArg
  const desktopPath = directory.replaceAll("\\", "\\\\")
  const launchFields = "Path=" + desktopPath + "\nExec=" + command
  const launcher = () => {
    if (
      !isAbsolute(executable) ||
      [...executable].some((character) => character.charCodeAt(0) < 32)
    )
      throw new Error("STARTUP_EXECUTABLE_PATH_INVALID")
    if ([...directory].some((character) => character.charCodeAt(0) < 32))
      throw new Error("STARTUP_CONFIG_PATH_INVALID")
    return xdgLauncherScript(executable)
  }

  return {
    /** 检查当前程序的自启入口，识别在桌面环境里关闭的入口。 */
    async enabled(): Promise<boolean> {
      const entry = desktopEntry((await readOptional(filePath)) ?? "")
      return (
        isEnabled(entry) &&
        entry.get("Exec") === command &&
        entry.get("Path") === desktopPath &&
        (await readOptional(launcherPath)) === launcher()
      )
    },
    /** 升级仍启用的旧入口，保留桌面环境里停用的条目和其他键。 */
    async migrateLegacyEntry(): Promise<void> {
      const content = await readOptional(filePath)
      if (content === null) return
      const entry = desktopEntry(content)
      const legacy = xdgExecCommand(executable, "pigclaude-autostart", backgroundArg)
      if (!isEnabled(entry) || entry.get("Exec") !== legacy || entry.has("Path")) return
      const updated = content.replace("\nExec=" + legacy + "\n", () => "\n" + launchFields + "\n")
      if (updated === content) return
      await writeXdgFile(launcherPath, launcher())
      await writeXdgFile(filePath, updated)
    },
    /** 先保存启动脚本再登记入口，关闭时移除本应用的两个文件。 */
    async set(enabled: boolean): Promise<boolean> {
      if (!enabled) {
        await rm(filePath, { force: true })
        await rm(launcherPath, { force: true })
        return false
      }
      const content = ["[Desktop Entry]", "Type=Application", "Name=PigClaude", launchFields, ""]
      // Path 与独立脚本将安装路径留在 shell 文件里，两个桌面启动器都只解析简单命令。
      await writeXdgFile(launcherPath, launcher())
      await writeXdgFile(filePath, content.join("\n"))
      return true
    },
  }
}

async function readOptional(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8")
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null
    throw error
  }
}

function isEnabled(entry: Map<string, string>): boolean {
  return entry.get("Hidden") !== "true" && entry.get("X-GNOME-Autostart-enabled") !== "false"
}

function desktopEntry(content: string): Map<string, string> {
  const entry = new Map<string, string>()
  let isEntry = false
  for (const line of content.split(/\r?\n/)) {
    const text = line.trim()
    if (text.startsWith("[")) isEntry = text === "[Desktop Entry]"
    const separator = text.indexOf("=")
    if (isEntry && separator > 0 && !text.startsWith("#"))
      entry.set(text.slice(0, separator).trim(), text.slice(separator + 1).trim())
  }
  return entry
}
