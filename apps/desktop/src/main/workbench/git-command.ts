// 负责工作台的 Git 子进程，限制执行时间、输出和外部 Git 扩展。
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { workbenchChildEnv } from "./child-env"

const execute = promisify(execFile)

/** 工作台读写 Git 时只使用参数数组，避免 shell、分页器、钩子或 diff 程序改写请求。 */
export async function runWorkbenchGit(
  root: string,
  args: string[],
  overrides: Record<string, string> = {},
): Promise<string> {
  const options = ["--no-pager", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false"]
  const { stdout } = await execute("git", [...options, ...args], {
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
  return stdout
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
