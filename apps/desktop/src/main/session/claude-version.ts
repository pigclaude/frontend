// 负责读出应用实际使用的 Claude Code 版本：运行 `claude --version`，只取版本号。
// 不带用户环境运行，不读写 ~/.claude；读不到时返回 null，由界面显示「—」。

import { execFile } from "node:child_process"
import { resolveClaudeBinaryPath } from "./claude-binary"

/** 运行一次 `--version` 的边界；测试可替换。 */
export type RunVersion = (binary: string) => Promise<string>

/** 读取 Claude Code 版本的可注入参数。 */
export type ClaudeVersionOptions = {
  resolveBinary?: () => string
  run?: RunVersion
}

/** 返回形如 `2.1.310` 的版本号；找不到二进制、运行失败、超时或输出不认识时返回 null，从不抛错。 */
export async function readClaudeCodeVersion(
  options: ClaudeVersionOptions = {},
): Promise<string | null> {
  try {
    const binary = (options.resolveBinary ?? (() => resolveClaudeBinaryPath()))()
    const output = await (options.run ?? runVersion)(binary)
    return /^(\d+\.\d+\.\d+)/.exec(output.trim())?.[1] ?? null
  } catch {
    return null
  }
}

function runVersion(binary: string): Promise<string> {
  // Windows 上的可执行文件缺了 SystemRoot 可能起不来；其他变量一律不带。
  const env: Record<string, string> =
    process.platform === "win32" ? { SystemRoot: process.env.SystemRoot ?? "C:\\Windows" } : {}
  return new Promise((resolve, reject) => {
    execFile(
      binary,
      ["--version"],
      { env, timeout: 5_000, killSignal: "SIGKILL", maxBuffer: 4_096, windowsHide: true },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    )
  })
}
