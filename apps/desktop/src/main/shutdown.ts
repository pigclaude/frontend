// 负责应用退出流程：资源未确认关闭时保持进程并报告失败或超时。

/** quit 流程只需要事件能阻止默认行为；Electron 的 Event 满足这个形状。 */
export type QuitEvent = {
  preventDefault(): void
}

/** 退出协调器依赖；清理失败或超时时通知用户。 */
export type QuitCoordinatorOptions = {
  shutdown: () => Promise<void>
  quit: () => void
  onFailure: (reason: "failed" | "timeout") => void
  onBeforeShutdown?: () => void
  timeoutMs?: number
}

/**
 * 创建 before-quit 处理器。保证 shutdown 只执行一次，期间重复事件继续阻止默认退出；
 * shutdown 成功后允许真正退出；失败或超时时继续保留进程。
 */
export function createQuitCoordinator(options: QuitCoordinatorOptions): (event: QuitEvent) => void {
  const timeoutMs = options.timeoutMs ?? 5_000
  let phase: "idle" | "running" | "done" = "idle"
  let timedOut = false

  return (event) => {
    if (phase === "done") return
    event.preventDefault()
    if (phase === "running") {
      if (timedOut) options.onFailure("timeout")
      return
    }
    phase = "running"
    options.onBeforeShutdown?.()
    void finish()
  }

  async function finish(): Promise<void> {
    const timer = setTimeout(() => {
      timedOut = true
      options.onFailure("timeout")
    }, timeoutMs)
    try {
      await options.shutdown()
      phase = "done"
      options.quit()
    } catch {
      phase = "idle"
      timedOut = false
      options.onFailure("failed")
    } finally {
      clearTimeout(timer)
    }
  }
}
