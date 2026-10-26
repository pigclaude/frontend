// 负责应用退出流程：首次 before-quit 阻止默认退出，有界等待关闭流程，然后触发真正退出。
// 不依赖 Electron 运行时，便于用假事件验证等待、超时和重复触发。

/** quit 流程只需要事件能阻止默认行为；Electron 的 Event 满足这个形状。 */
export type QuitEvent = {
  preventDefault(): void
}

/** 退出协调器依赖；shutdown 失败也必须继续退出，超时则强制结束进程。 */
export type QuitCoordinatorOptions = {
  shutdown: () => Promise<void>
  quit: () => void
  forceExit: () => void
  onBeforeShutdown?: () => void
  timeoutMs?: number
}

/**
 * 创建 before-quit 处理器。保证 shutdown 只执行一次，期间重复事件继续阻止默认退出；
 * shutdown 完成或超时后允许真正的 quit 事件通过，超时走 forceExit。
 */
export function createQuitCoordinator(options: QuitCoordinatorOptions): (event: QuitEvent) => void {
  const timeoutMs = options.timeoutMs ?? 5_000
  let phase: "idle" | "running" | "done" = "idle"

  return (event) => {
    if (phase === "done") return
    event.preventDefault()
    if (phase === "running") return
    phase = "running"
    options.onBeforeShutdown?.()
    void finish()
  }

  async function finish(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | null = null
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), timeoutMs)
    })
    const shutdown = options.shutdown().then(
      () => "completed" as const,
      () => "completed" as const,
    )
    let outcome: "completed" | "timeout"
    try {
      outcome = await Promise.race([shutdown, timeout])
    } finally {
      if (timer !== null) clearTimeout(timer)
    }
    phase = "done"
    if (outcome === "timeout") options.forceExit()
    else options.quit()
  }
}
