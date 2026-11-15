// 负责应用退出流程：先确认进行中的工作，资源未确认关闭时保持进程并报告失败或超时。
import { SessionHistoryWriteError } from "./session/session-history-write-error"

/** quit 流程只需要事件能阻止默认行为；Electron 的 Event 满足这个形状。 */
export type QuitEvent = {
  preventDefault(): void
}

/** 退出被保存失败、资源清理失败或清理超时阻止。 */
export type QuitFailure = "session-save" | "failed" | "timeout"

/** 区分用户主动退出和操作系统关机或注销。 */
export type QuitMode = "normal" | "system"

/** 退出协调器依赖；清理失败或超时时通知用户。 */
export type QuitCoordinatorOptions = {
  shutdown: () => Promise<void>
  quit: (mode: QuitMode) => void
  onFailure: (reason: QuitFailure) => void
  onBeforeShutdown?: () => void
  /**
   * 退出前的确认。立即得到 true 时马上开始清理；异步得到 false 时取消这次退出，什么都不清理。
   * 确认本身出错时照常退出。
   */
  confirm?: () => true | Promise<boolean>
  timeoutMs?: number
}

/** 退出协调器为两种退出来源提供统一的清理入口。 */
export type QuitCoordinator = {
  /** 空闲时允许窗口关闭触发一次新的退出。 */
  canStartQuit(): boolean
  /** 用户主动退出时先确认，再清理资源。 */
  beforeQuit(event: QuitEvent): void
  /** 系统退出时撤销等待中的确认，立即进入清理。 */
  systemQuit(): void
}

/**
 * 创建 before-quit 处理器。保证确认和 shutdown 都只进行一次，期间重复事件继续阻止默认退出；
 * 用户取消时不清理任何资源，下次退出重新确认；shutdown 成功后允许真正退出；失败或超时时继续保留进程。
 */
export function createQuitCoordinator(options: QuitCoordinatorOptions): QuitCoordinator {
  const timeoutMs = options.timeoutMs ?? 5_000
  let phase: "idle" | "confirming" | "running" | "done" = "idle"
  let timedOut = false
  let mode: QuitMode = "normal"

  return {
    canStartQuit: () => phase === "idle",
    beforeQuit(event) {
      if (phase === "done") return
      event.preventDefault()
      if (phase === "confirming") return
      if (phase === "running") {
        if (timedOut) options.onFailure("timeout")
        return
      }
      const answer = options.confirm?.() ?? true
      if (answer === true) {
        start()
        return
      }
      phase = "confirming"
      void answer
        .catch(() => true)
        .then((confirmed) => {
          if (phase !== "confirming") return
          if (confirmed) start()
          else phase = "idle"
        })
    },
    systemQuit() {
      if (phase === "done") return
      mode = "system"
      if (phase === "running") {
        if (timedOut) exit()
      } else {
        start()
      }
    },
  }

  function start(): void {
    phase = "running"
    void finish()
  }

  function exit(): void {
    if (phase === "done") return
    phase = "done"
    options.quit(mode)
  }

  async function finish(): Promise<void> {
    const timer = setTimeout(() => {
      timedOut = true
      if (mode === "system") exit()
      else options.onFailure("timeout")
    }, timeoutMs)
    try {
      options.onBeforeShutdown?.()
      await options.shutdown()
      exit()
    } catch (error) {
      if (mode === "system") exit()
      else {
        phase = "idle"
        timedOut = false
        options.onFailure(error instanceof SessionHistoryWriteError ? "session-save" : "failed")
      }
    } finally {
      clearTimeout(timer)
    }
  }
}
