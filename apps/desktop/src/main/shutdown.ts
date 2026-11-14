// 负责应用退出流程：先确认进行中的工作，资源未确认关闭时保持进程并报告失败或超时。

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
  /**
   * 退出前的确认。立即得到 true 时马上开始清理；异步得到 false 时取消这次退出，什么都不清理。
   * 确认本身出错时照常退出。
   */
  confirm?: () => true | Promise<boolean>
  timeoutMs?: number
}

/**
 * 创建 before-quit 处理器。保证确认和 shutdown 都只进行一次，期间重复事件继续阻止默认退出；
 * 用户取消时不清理任何资源，下次退出重新确认；shutdown 成功后允许真正退出；失败或超时时继续保留进程。
 */
export function createQuitCoordinator(options: QuitCoordinatorOptions): (event: QuitEvent) => void {
  const timeoutMs = options.timeoutMs ?? 5_000
  let phase: "idle" | "confirming" | "running" | "done" = "idle"
  let timedOut = false

  return (event) => {
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
        if (confirmed) start()
        else phase = "idle"
      })
  }

  function start(): void {
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
