// 启动和管理工作台的真实 PTY，按主窗口绑定输入、尺寸、输出和进程生命周期。
import { execFile } from "node:child_process"
import { createRequire } from "node:module"
import { setTimeout as delay } from "node:timers/promises"
import type { WebContents } from "electron"
import type { IPty } from "node-pty"
import type { WorkbenchEvent } from "../../workbench-contract"
import { workbenchChildEnv } from "./child-env"

const requirePty = createRequire(import.meta.url)
const maxTerminals = 16
type TerminalEntry = {
  owner: WebContents
  child: IPty
  stop?: Promise<void>
  exited: Promise<void>
}

/** 保存本次应用运行中的终端，终端进程不会跨窗口恢复。 */
export class WorkbenchTerminals {
  readonly #entries = new Map<string, TerminalEntry>()

  /** 在已经验证的项目目录启动交互式 shell，拒绝重复的资源 ID。 */
  open(owner: WebContents, id: string, root: string): void {
    if (this.#entries.has(id) || this.#entries.size >= maxTerminals) {
      throw new Error("WORKBENCH_TERMINAL_LIMIT")
    }
    const { spawn } = requirePty("node-pty") as typeof import("node-pty")
    const shell =
      process.platform === "win32"
        ? (process.env["ComSpec"] ?? process.env["COMSPEC"] ?? "cmd.exe")
        : (process.env["SHELL"] ?? (process.platform === "darwin" ? "/bin/zsh" : "/bin/sh"))
    let child: IPty
    try {
      child = spawn(shell, [], {
        cwd: root,
        cols: 80,
        rows: 24,
        name: "xterm-256color",
        env: { ...workbenchChildEnv(), TERM: "xterm-256color", COLORTERM: "truecolor" },
      })
    } catch {
      throw new Error("WORKBENCH_TERMINAL_FAILED")
    }
    let confirmExit: () => void = () => undefined
    const exited = new Promise<void>((resolve) => {
      confirmExit = resolve
    })
    const entry: TerminalEntry = { owner, child, exited }
    this.#entries.set(id, entry)
    child.onData((data) => {
      if (!entry.stop) this.#send(owner, { type: "terminal-data", id, data })
    })
    child.onExit(({ exitCode }) => {
      if (this.#entries.get(id) === entry) this.#entries.delete(id)
      confirmExit()
      this.#send(owner, { type: "terminal-exit", id, exitCode })
    })
  }

  /** 将当前窗口的键盘输入写到指定 PTY。 */
  write(owner: WebContents, id: string, data: string): void {
    const entry = this.#entries.get(id)
    if (entry?.owner === owner && !entry.stop) entry.child.write(data)
  }

  /** 调整当前窗口终端的 PTY 大小。 */
  resize(owner: WebContents, id: string, cols: number, rows: number): void {
    const entry = this.#entries.get(id)
    if (entry?.owner === owner && !entry.stop) entry.child.resize(cols, rows)
  }

  /** 关闭当前窗口的一个终端并等待退出；重复请求共享清理。 */
  async close(owner: WebContents, id: string): Promise<void> {
    const entry = this.#entries.get(id)
    if (entry?.owner !== owner) return
    const stop = (entry.stop ??= stopTerminal(entry))
    try {
      await stop
    } catch (error) {
      if (entry.stop === stop) delete entry.stop
      throw error
    }
  }

  /** 在会员状态变化、刷新或退出时关闭属于该窗口的全部终端。 */
  async closeWindow(owner: WebContents): Promise<void> {
    await Promise.all([...this.#entries.keys()].map((id) => this.close(owner, id)))
  }

  /** 退出前等待所有已创建的终端结束。 */
  async dispose(): Promise<void> {
    const windows = new Set([...this.#entries.values()].map(({ owner }) => owner))
    await Promise.all([...windows].map((owner) => this.closeWindow(owner)))
  }

  #send(owner: WebContents, event: WorkbenchEvent): void {
    if (!owner.isDestroyed()) owner.send("pigclaude:workbench-event", event)
  }
}

async function stopTerminal(entry: TerminalEntry): Promise<void> {
  const { child, exited } = entry
  try {
    if (process.platform === "win32") {
      await new Promise<void>((resolve) => {
        execFile(
          "taskkill",
          ["/PID", String(child.pid), "/T", "/F"],
          {
            windowsHide: true,
            timeout: 2_000,
          },
          () => resolve(),
        )
      })
      child.kill()
    } else {
      process.kill(-child.pid, "SIGHUP")
    }
  } catch {
    // 进程可能已退出，等待退出事件确认。
  }
  if (await Promise.race([exited.then(() => true), delay(350, false, { ref: false })])) return
  try {
    if (process.platform === "win32") child.kill()
    else process.kill(-child.pid, "SIGKILL")
  } catch {
    // 正在投递退出事件时信号可能已无法送达。
  }
  if (!(await Promise.race([exited.then(() => true), delay(1_200, false, { ref: false })]))) {
    throw new Error("WORKBENCH_TERMINAL_CLOSE_FAILED")
  }
}
