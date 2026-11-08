// 识别本次命令行明确要求加载的扩展目录，供浏览器启动时核对。

import { realpath, stat } from "node:fs/promises"
import { trimLaunchArgument } from "./launch-argument-guard"

/** 返回本次有效扩展开关的真实目录；无法读取时不泄露原始路径。 */
export async function expectedExtensionPaths(
  args: readonly string[],
  platform: NodeJS.Platform,
): Promise<string[]> {
  let value: string | undefined
  for (const raw of args) {
    const arg = trimLaunchArgument(raw, platform)
    if (arg === "--") break
    const prefix = arg.startsWith("--")
      ? 2
      : arg.startsWith("-") || (platform === "win32" && arg.startsWith("/"))
        ? 1
        : 0
    if (prefix === 0) continue
    const separator = arg.indexOf("=")
    const rawKey = arg.slice(prefix, separator < 0 ? undefined : separator)
    const key = platform === "win32" ? rawKey.toLowerCase() : rawKey
    if (key !== "load-extension") continue
    value = separator < 0 ? "" : arg.slice(separator + 1)
  }
  if (value === undefined) return []
  if (value === "") throw new Error("指定的扩展目录不可用")
  try {
    const paths = await Promise.all(
      value.split(",").map(async (path) => {
        if (path === "") throw new Error("empty path")
        const resolved = await realpath(path)
        if (!(await stat(resolved)).isDirectory()) throw new Error("not a directory")
        return resolved
      }),
    )
    const unique = new Map<string, string>()
    for (const path of paths) unique.set(platform === "win32" ? path.toLowerCase() : path, path)
    return [...unique.values()]
  } catch {
    throw new Error("指定的扩展目录不可用")
  }
}
