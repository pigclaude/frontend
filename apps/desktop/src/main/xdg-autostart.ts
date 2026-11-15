// 负责生成和移除本用户的 XDG 自启入口，程序路径始终按桌面入口格式引用。

import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { dirname, isAbsolute, join } from "node:path"

/** 为 PigClaude 的固定桌面入口读写自动启动状态，不执行入口中的命令。 */
export function createXdgAutostart(
  home: string,
  configHome: string | undefined,
  executable: string,
  backgroundArg: string,
) {
  const config = configHome && isAbsolute(configHome) ? configHome : join(home, ".config")
  const filePath = join(config, "autostart", "pigclaude-autostart.desktop")
  const command = () => {
    if (
      !isAbsolute(executable) ||
      [...executable].some((character) => character.charCodeAt(0) < 32)
    )
      throw new Error("STARTUP_EXECUTABLE_PATH_INVALID")
    // GIO 在展开字段码前检查命令的首个词，因此让实际路径只作为参数。
    return [
      "/bin/sh -c",
      quoteExecArgument('exec "$@"'),
      "pigclaude-autostart",
      quoteExecArgument(executable),
      backgroundArg,
    ].join(" ")
  }

  return {
    /** 检查当前程序的自启入口，识别在桌面环境里关闭的入口。 */
    async enabled(): Promise<boolean> {
      try {
        const entry = desktopEntry(await readFile(filePath, "utf8"))
        return (
          entry.get("Exec") === command() &&
          entry.get("Hidden") !== "true" &&
          entry.get("X-GNOME-Autostart-enabled") !== "false"
        )
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return false
        throw error
      }
    },
    /** 启用时原子写入当前程序，关闭时仅移除自己的入口。 */
    async set(enabled: boolean): Promise<boolean> {
      if (!enabled) {
        await rm(filePath, { force: true })
        return false
      }
      const content = [
        "[Desktop Entry]",
        "Type=Application",
        "Name=PigClaude",
        "Exec=" + command(),
        "",
      ]
      const temporary = filePath + "." + randomUUID() + ".tmp"
      await mkdir(dirname(filePath), { recursive: true, mode: 0o700 })
      try {
        await writeFile(temporary, content.join("\n"), { mode: 0o600, flag: "wx" })
        await rename(temporary, filePath)
      } finally {
        await rm(temporary, { force: true }).catch(() => undefined)
      }
      return true
    },
  }
}

function quoteExecArgument(value: string): string {
  const escaped = [...value]
    .map((character) => {
      if (character === "%") return "%%"
      if (character === "\\") return "\\\\\\\\"
      if (['"', "$", "`"].includes(character)) return "\\\\" + character
      return character
    })
    .join("")
  return '"' + escaped + '"'
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
