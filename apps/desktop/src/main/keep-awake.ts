// 汇总主进程的活动回合与本机手动偏好，按需持有一个阻止空闲睡眠的 Electron 请求。

import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { mkdir, rename, rm, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import type { IpcMain, IpcMainInvokeEvent } from "electron"
import type { SessionEnvelope } from "./session/session-envelope"

/** 只使用 Electron 的系统空闲睡眠请求，显示器照常休眠。 */
export type IdleSleepBlocker = {
  start(type: "prevent-app-suspension"): number
  stop(id: number): void
}

/** 应用级唤醒控制；有活动回合或用户手动开启时保持一个阻止空闲睡眠的请求。 */
export class KeepAwake {
  readonly #turns = new Map<string, string>()
  #manual: boolean
  #blockerId: number | null = null
  #ready = false
  #disposed = false
  #holdExisting = false
  #writes = Promise.resolve()

  /** 从本机数据目录读取手动偏好。首次运行或文件损坏时默认关闭。 */
  constructor(
    private readonly filePath: string,
    private readonly blocker: IdleSleepBlocker,
  ) {
    this.#manual = readPreference(filePath)
  }

  /** Electron 就绪后应用已保存的设置。 */
  ready(): void {
    this.#ready = true
    this.#reconcile()
  }

  /** 手动开关的已保存状态，与自动保护是否启用分开显示。 */
  enabled(): boolean {
    return this.#manual
  }

  /** 按调用顺序原子保存手动开关，写入成功后才改变设置。 */
  setEnabled(enabled: boolean): Promise<boolean> {
    const result = this.#writes.then(async () => {
      if (this.#disposed) throw new Error("KEEP_AWAKE_SETTINGS_UNAVAILABLE")
      if (enabled !== this.#manual) await this.#save(enabled)
      this.#manual = enabled
      this.#reconcile()
      return enabled
    })
    this.#writes = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  /** 只消费会话宿主的实时回合开闭，忽略不属于该回合的结束事件。 */
  observe({ sessionId, event }: Pick<SessionEnvelope, "sessionId" | "event">): void {
    if (this.#disposed || sessionId === null) return
    if (event.type === "turn-started") this.#turns.set(sessionId, event.turnId)
    else if (event.type === "turn-ended" && this.#turns.get(sessionId) === event.turnId)
      this.#turns.delete(sessionId)
    else return
    this.#reconcile()
  }

  /** 应用开始退出时保留已有请求，回合结束后也等资源清理完成。 */
  holdForShutdown(): void {
    this.#holdExisting = true
  }

  /** 退出失败时恢复日常判定，按当前回合和手动偏好决定是否继续持有。 */
  resumeAfterFailedShutdown(): void {
    this.#holdExisting = false
    this.#reconcile()
  }

  /** 应用确定退出时释放请求，保留手动开关供下次启动。 */
  dispose(): void {
    this.#disposed = true
    this.#turns.clear()
    this.#reconcile()
  }

  #reconcile(): void {
    const heldForShutdown = this.#holdExisting && this.#blockerId !== null
    const needed =
      this.#ready && !this.#disposed && (this.#manual || this.#turns.size > 0 || heldForShutdown)
    try {
      if (needed && this.#blockerId === null)
        this.#blockerId = this.blocker.start("prevent-app-suspension")
      else if (!needed && this.#blockerId !== null) {
        this.blocker.stop(this.#blockerId)
        this.#blockerId = null
      }
    } catch {
      // 电源接口失败不能阻断桌面启动或会话计时。
      console.error("KEEP_AWAKE_BLOCKER_FAILED")
    }
  }

  async #save(enabled: boolean): Promise<void> {
    const temporary = `${this.filePath}.${randomUUID()}.tmp`
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 })
    try {
      await writeFile(temporary, `${JSON.stringify({ keepAwake: enabled })}\n`, {
        encoding: "utf8",
        mode: 0o600,
      })
      await rename(temporary, this.filePath)
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined)
    }
  }
}

/** 仅允许可信窗口读取和修改本机偏好，写入只接收布尔值。 */
export function registerKeepAwakeIpc(
  ipc: Pick<IpcMain, "handle">,
  keepAwake: Pick<KeepAwake, "enabled" | "setEnabled">,
  isTrusted: (event: IpcMainInvokeEvent) => boolean,
): void {
  ipc.handle("pigclaude:keep-awake-get", (event) => {
    if (!isTrusted(event)) throw new Error("UNTRUSTED_KEEP_AWAKE_REQUEST")
    return keepAwake.enabled()
  })
  ipc.handle("pigclaude:keep-awake-set", async (event, enabled: unknown) => {
    if (!isTrusted(event)) throw new Error("UNTRUSTED_KEEP_AWAKE_REQUEST")
    if (typeof enabled !== "boolean") throw new Error("KEEP_AWAKE_SETTINGS_INVALID")
    try {
      return await keepAwake.setEnabled(enabled)
    } catch {
      throw new Error("KEEP_AWAKE_SETTINGS_FAILED")
    }
  })
}

function readPreference(file: string): boolean {
  try {
    const value: unknown = JSON.parse(readFileSync(file, "utf8"))
    return (
      typeof value === "object" &&
      value !== null &&
      "keepAwake" in value &&
      value.keepAwake === true
    )
  } catch {
    return false
  }
}
