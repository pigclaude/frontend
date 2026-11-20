// 负责生成 XDG 可执行命令和原子保存用户级启动文件。

import { randomUUID } from "node:crypto"
import { mkdir, rename, rm, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

/** 把 AppImage 路径放在参数位置，保留安装路径和 XDG 字段码的原意。 */
export function xdgExecCommand(executable: string, launcher: string, argument: string): string {
  // GIO 会先校验 Exec 的第一项。固定的 shell 只负责按原样转交参数。
  return [
    "/bin/sh -c",
    quoteExecArgument('exec "$@"'),
    launcher,
    quoteExecArgument(executable),
    argument,
  ].join(" ")
}

/** 用独立脚本承载 shell 命令，使 xdg-open 的通用分发器也能解析简单路径。 */
export function xdgScriptExec(script: string, argument: string): string {
  if ([...script].some((character) => character.charCodeAt(0) < 32)) {
    throw new Error("XDG_SCRIPT_PATH_INVALID")
  }
  const path = /^\/[A-Za-z0-9_./+=-]+$/.test(script) ? script : quoteExecArgument(script)
  return `/bin/sh ${path} ${argument}`
}

/** 以同目录临时文件替换用户级启动文件，避免桌面环境读到写入一半的文件。 */
export async function writeXdgFile(filePath: string, content: string): Promise<void> {
  const temporary = filePath + "." + randomUUID() + ".tmp"
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 })
  try {
    await writeFile(temporary, content, { mode: 0o600, flag: "wx" })
    await rename(temporary, filePath)
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined)
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
