// 负责工作台的 Git 子进程，限制执行时间、输出和外部 Git 扩展。
import { execFile } from "node:child_process"
import { platform } from "node:os"
import { promisify } from "node:util"
import { workbenchChildEnv } from "./child-env"

const execute = promisify(execFile)
const failedSubcommands = new WeakMap<object, string>()
const repeatableReads = new Set(["rev-parse", "ls-files", "ls-tree"])
const repeatableIndexWrites = new Set(["add", "write-tree"])

/**
 * 工作台读写 Git 时只使用参数数组，避免 shell、分页器、钩子或 diff 程序改写请求。给了 input 时
 * 写进标准输入后关闭。
 */
export async function runWorkbenchGit(
  root: string,
  args: string[],
  overrides: Record<string, string> = {},
  input?: string,
): Promise<string> {
  const options = ["--no-pager", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false"]
  const command = subcommand(args)
  // 只有检查点的独立索引使用 GIT_INDEX_FILE。重试准备步骤不会改动用户的索引或工作树。
  const repeatable =
    platform() === "win32" &&
    input === undefined &&
    (repeatableReads.has(command) ||
      (Boolean(overrides.GIT_INDEX_FILE) && repeatableIndexWrites.has(command)))
  async function launch(): Promise<string> {
    const pending = execute("git", [...options, ...args], {
      cwd: root,
      env: {
        ...workbenchChildEnv(),
        GIT_TERMINAL_PROMPT: "0",
        GIT_OPTIONAL_LOCKS: "0",
        ...overrides,
      },
      maxBuffer: 4 * 1024 * 1024,
      timeout: 15_000,
      windowsHide: true,
    })
    if (input !== undefined) pending.child.stdin?.end(input)
    const { stdout } = await pending
    return stdout
  }

  try {
    return await launch().catch(async (error: unknown) => {
      if (!repeatable || !isSilentGitExit(error)) throw error
      const stdout = await launch()
      if (process.env.CI) console.error("Workbench Git recovered", command)
      return stdout
    })
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null) failedSubcommands.set(error, command)
    throw error
  }
}

function isSilentGitExit(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false
  return (
    "code" in error &&
    error.code === 1 &&
    "stderr" in error &&
    error.stderr === "" &&
    (!("signal" in error) || error.signal === null || error.signal === undefined) &&
    (!("killed" in error) || error.killed !== true)
  )
}

function subcommand(args: string[]): string {
  let index = 0
  while (args[index] === "-c") index += 2
  const name = args[index] ?? ""
  return /^[a-z][a-z-]{0,30}$/.test(name) ? name : "unknown"
}

/** 描述工作台 Git 子进程的失败，只含子命令、退出码（数字或大写错误名）和信号，不含路径、参数或输出。 */
export function describeWorkbenchGitFailure(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null
  const name = failedSubcommands.get(error)
  if (name === undefined) return null
  const code = gitExitCode(error)
  const signal = "signal" in error ? error.signal : null
  const exit =
    typeof code === "number" || (typeof code === "string" && /^[A-Z0-9_]{1,35}$/.test(code))
      ? String(code)
      : "none"
  const signalName = typeof signal === "string" && /^SIG[A-Z0-9]+$/.test(signal) ? signal : "none"
  return `git ${name} code=${exit} signal=${signalName}`
}

/** 检查项目目录属于 Git 工作树；普通目录返回工作台可展示的错误。 */
export async function assertWorkbenchGit(root: string): Promise<void> {
  const output = await runWorkbenchGit(root, ["rev-parse", "--is-inside-work-tree"]).catch(() => "")
  if (output.trim() !== "true") throw new Error("WORKBENCH_NOT_GIT")
}

/** 返回 Git 命令的可读退出码，且不会把环境变量或命令行凭据放进 renderer。 */
export function gitExitCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error ? error.code : undefined
}
