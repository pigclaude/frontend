// 负责工作台的 Git 子进程，限制执行时间、输出和外部 Git 扩展。
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { workbenchChildEnv } from "./child-env"

const execute = promisify(execFile)
const failedSubcommands = new WeakMap<object, string>()
const diagnosticDetails = new WeakMap<object, string>()

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
  const startedAt = Date.now()
  let pid: number | undefined
  try {
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
    pid = pending.child.pid
    if (input !== undefined) pending.child.stdin?.end(input)
    const { stdout } = await pending
    return stdout
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null) {
      failedSubcommands.set(error, subcommand(args))
      if (process.env.PIGCLAUDE_CI_DIAG_164 === "1") {
        const stdout = "stdout" in error && typeof error.stdout === "string" ? error.stdout : ""
        const stderr = "stderr" in error && typeof error.stderr === "string" ? error.stderr : ""
        diagnosticDetails.set(
          error,
          ` pid=${pid ?? 0} elapsedMs=${Date.now() - startedAt} stdoutBytes=${Buffer.byteLength(stdout)} stderrBytes=${Buffer.byteLength(stderr)} stderrKind=${classifyGitStderr(stderr)}`,
        )
      }
    }
    throw error
  }
}

function classifyGitStderr(stderr: string): string {
  if (!stderr) return "empty"
  if (/index\.lock|unable to lock|cannot lock/i.test(stderr)) return "lock"
  if (/index|unmerged|error building trees/i.test(stderr)) return "index"
  if (/permission denied|cannot (?:read|write)|unable to (?:write|create)/i.test(stderr))
    return "filesystem"
  return "other"
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
  return `git ${name} code=${exit} signal=${signalName}${diagnosticDetails.get(error) ?? ""}`
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
