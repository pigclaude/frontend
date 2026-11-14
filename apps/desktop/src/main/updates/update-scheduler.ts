// 负责自动检查更新的节拍：启动 5 秒后查一次，之后每 6 小时一次；同一时刻只进行一次检查。

/** 启动后第一次检查的延迟，不和启动抢资源。 */
export const STARTUP_DELAY_MS = 5_000
/** 之后每 6 小时检查一次。 */
export const INTERVAL_MS = 6 * 60 * 60 * 1000

/** 定时器能力；测试里换成假的。 */
export type SchedulerTimers = {
  setTimeout: (callback: () => void, ms: number) => unknown
  setInterval: (callback: () => void, ms: number) => unknown
  clearTimeout: (handle: unknown) => void
  clearInterval: (handle: unknown) => void
}

/** 自动检查的开关和一次检查的动作。 */
export type UpdateSchedulerOptions<T> = {
  /** 自动检查是否开启；每次 start 时读取。 */
  autoCheck: () => boolean
  check: () => Promise<T>
  timers?: SchedulerTimers
}

/** 按当前开关起停自动检查，并让手动检查和自动检查共用同一次进行中的请求。 */
export type UpdateScheduler<T> = {
  /** 按当前开关重新安排定时器；开关变了再调一次。 */
  start(): void
  /** 取消定时器；进行中的检查照常结束。 */
  stop(): void
  /** 立即检查；已经有检查在进行时返回同一个结果。 */
  checkNow(): Promise<T>
}

/** 创建更新检查的节拍器；关掉自动检查时不会发出任何请求。 */
export function createUpdateScheduler<T>(options: UpdateSchedulerOptions<T>): UpdateScheduler<T> {
  const timers: SchedulerTimers = options.timers ?? {
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    setInterval: (callback, ms) => setInterval(callback, ms),
    clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
    clearInterval: (handle) => clearInterval(handle as NodeJS.Timeout),
  }
  let startup: unknown
  let interval: unknown
  let running: Promise<T> | null = null

  const checkNow = (): Promise<T> => {
    running ??= options.check().finally(() => {
      running = null
    })
    return running
  }
  const tick = () => void checkNow().catch(() => undefined)
  const stop = () => {
    if (startup !== undefined) timers.clearTimeout(startup)
    if (interval !== undefined) timers.clearInterval(interval)
    startup = undefined
    interval = undefined
  }

  return {
    start() {
      stop()
      if (!options.autoCheck()) return
      startup = timers.setTimeout(tick, STARTUP_DELAY_MS)
      interval = timers.setInterval(tick, INTERVAL_MS)
    },
    stop,
    checkNow,
  }
}
