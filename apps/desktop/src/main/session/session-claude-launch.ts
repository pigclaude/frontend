// 负责可续接会话的 SDK 子进程。发送和启动完成前先保存进程身份，只有真实退出后才撤除记录。

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { setTimeout as delay } from "node:timers/promises"
import type { SpawnOptions, SpawnedProcess } from "@anthropic-ai/claude-agent-sdk"
import { forgetRetainedClaudeProcess, recordRetainedClaudeProcess } from "./retained-claude-process"

/** 当前启动的 CLI 仍可能写入会话目录，生命周期收尾必须保留该目录和身份。 */
export class SessionClaudeExitError extends Error {
  /** 仅公开固定错误文案。 */
  constructor() {
    super("Claude Code 进程尚未确认退出")
  }
}

/** 跟踪一个 SDK 查询启动的进程及其退出，用于保留会话记录。 */
export class SessionClaudeLaunch {
  #child: ChildProcessWithoutNullStreams | null = null
  #recorded = Promise.resolve()
  #exited = Promise.resolve()
  #forgotten = Promise.resolve()

  /** directory 是已经建立会话索引的目录。 */
  constructor(private readonly directory: string) {}

  /** 保留 SDK 的命令、环境和退出信号，只为实际启动的子进程登记身份。 */
  readonly spawn = (options: SpawnOptions): SpawnedProcess => {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: options.env,
      signal: options.signal,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    })
    this.#child = child
    child.stderr.resume()
    child.stderr.on("error", () => undefined)
    const exited = new Promise<void>((resolve) => child.once("close", () => resolve()))
    const identity = (async () => {
      if (child.pid === undefined) throw new Error("无法取得 Claude Code 进程编号")
      const saved = await recordRetainedClaudeProcess(this.directory, child.pid, options.command)
      if (saved === null) throw new Error("Claude Code 在启动期间退出")
      return saved
    })()
    this.#recorded = identity.then(() => undefined)
    void this.#recorded.catch(() => undefined)
    this.#exited = exited
    this.#forgotten = exited.then(async () => {
      const saved = await identity.catch(() => null)
      if (saved !== null) await forgetRetainedClaudeProcess(this.directory, saved)
    })
    void this.#forgotten.catch(() => undefined)
    return child
  }

  /** 等待实际进程身份落盘，记录失败时启动失败。 */
  ready(): Promise<void> {
    return this.#recorded
  }

  /** 等待 SDK 关闭本次查询的进程；宽限后只结束本对象启动的进程。 */
  async waitForExit(): Promise<void> {
    const child = this.#child
    if (child === null) return
    if (!(await this.#closedWithin(process.platform === "win32" ? 8_000 : 3_000))) {
      child.kill("SIGKILL")
      if (!(await this.#closedWithin(3_000))) throw new SessionClaudeExitError()
    }
    await this.#forgotten.catch(() => undefined)
  }

  #closedWithin(ms: number): Promise<boolean> {
    return Promise.race([
      this.#exited.then(
        () => true,
        () => true,
      ),
      delay(ms, false, { ref: false }),
    ])
  }
}
