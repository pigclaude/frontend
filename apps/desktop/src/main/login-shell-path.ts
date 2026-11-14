// 负责从图形入口启动时读取一次登录 shell 的 PATH，只把 PATH 合并进应用环境。
// 登录 shell 的其他变量（代理、API key 等）不能进入应用环境，否则会带进会话环境。
import { spawn, type ChildProcess } from "node:child_process"
import { randomUUID } from "node:crypto"
import { userInfo } from "node:os"

/** 等登录 shell 的最长时间；窗口也在等它，超过就沿用当前 PATH。 */
const loginShellTimeoutMs = 5_000

/**
 * 是否需要读取登录 shell：Windows 的图形应用本来就继承用户的 PATH；从终端启动时已有完整环境。
 * `TERM=linux` 例外：从 tty 启动的桌面会把它传下来，但没有经过登录 shell 的 rc 文件。
 */
export function needsLoginShellPath(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): boolean {
  return platform !== "win32" && (!env.TERM || env.TERM === "linux")
}

/**
 * 运行一次登录 shell，返回它的 PATH；shell 失败、超时或输出里找不到 PATH 时返回 null。
 * PATH 可能只在交互 rc 文件里设置，所以带 `-i`。rc 文件可能打印任何内容，所以输出前后加随机标记；
 * 读到结束标记就返回，不等输出关闭，rc 文件启动的后台进程可能一直占着 stdout。
 */
export function readLoginShellPath(
  shell: string,
  timeoutMs: number = loginShellTimeoutMs,
): Promise<string | null> {
  const mark = randomUUID()
  const command = `printf '%s' '${mark}'; /usr/bin/env -0; printf '%s' '${mark}'`
  return new Promise((resolve) => {
    let child: ChildProcess
    try {
      // 单独的进程组：放弃时连 rc 文件启动的子进程一起结束，也不占用任何终端。
      child = spawn(shell, ["-i", "-l", "-c", command], {
        detached: true,
        stdio: ["ignore", "pipe", "ignore"],
      })
    } catch {
      resolve(null)
      return
    }
    let output = ""
    let settled = false
    const abandon = (): void => killGroup(child)
    const finish = (value: string | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      process.off("exit", abandon)
      resolve(value)
    }
    const timer = setTimeout(() => {
      abandon()
      finish(null)
    }, timeoutMs)
    process.once("exit", abandon)
    child.stdout?.setEncoding("utf8")
    child.stdout?.on("data", (chunk: string) => {
      output += chunk
      const path = markedPath(output, mark)
      if (path !== undefined) finish(path)
    })
    child.once("error", () => finish(null))
    child.once("close", () => finish(markedPath(output, mark) ?? null))
  })
}

/**
 * 需要时读取登录 shell 的 PATH 并只合并进 env.PATH：登录 shell 的目录在前，原有目录不丢。
 * 不写入其他任何变量；读不到时 env 保持原样，应用照常启动。
 */
export async function applyLoginShellPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  if (!needsLoginShellPath(env, platform)) return
  const shell = env.SHELL || accountShell()
  if (!shell) return
  const path = await readLoginShellPath(shell)
  if (path === null) {
    console.warn("LOGIN_SHELL_PATH_UNAVAILABLE")
    return
  }
  env.PATH = mergePath(path, env.PATH)
}

function mergePath(loginPath: string, currentPath: string | undefined): string {
  const merged = new Set<string>()
  for (const dir of [...loginPath.split(":"), ...(currentPath ?? "").split(":")]) {
    if (dir !== "") merged.add(dir)
  }
  return [...merged].join(":")
}

function accountShell(): string | undefined {
  try {
    return userInfo().shell ?? undefined
  } catch {
    return undefined
  }
}

/** 取出两个标记之间 `env -0` 输出里的 PATH；结束标记还没到时返回 undefined，没有 PATH 时返回 null。 */
function markedPath(output: string, mark: string): string | null | undefined {
  const start = output.indexOf(mark)
  if (start < 0) return undefined
  const end = output.indexOf(mark, start + mark.length)
  if (end < 0) return undefined
  for (const entry of output.slice(start + mark.length, end).split("\0")) {
    if (entry.startsWith("PATH=") && entry.length > "PATH=".length) return entry.slice(5)
  }
  return null
}

function killGroup(child: ChildProcess): void {
  try {
    if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL")
  } catch {
    // 进程组已经结束。
  }
}
