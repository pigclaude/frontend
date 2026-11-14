// 验证自动检查的节拍：启动 5 秒后一次、之后每 6 小时，关掉时不安排；同时只有一次检查。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createUpdateScheduler, INTERVAL_MS, STARTUP_DELAY_MS } from "./update-scheduler"

describe("自动检查", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("启动 5 秒后检查一次，之后每 6 小时一次", async () => {
    const check = vi.fn(async () => "done")
    const scheduler = createUpdateScheduler({ autoCheck: () => true, check })
    scheduler.start()
    await vi.advanceTimersByTimeAsync(STARTUP_DELAY_MS - 1)
    expect(check).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(check).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(INTERVAL_MS)
    expect(check).toHaveBeenCalledTimes(2)
    scheduler.stop()
    await vi.advanceTimersByTimeAsync(INTERVAL_MS)
    expect(check).toHaveBeenCalledTimes(2)
  })

  it("关掉自动检查时不安排任何检查，手动检查照常", async () => {
    const check = vi.fn(async () => "done")
    const scheduler = createUpdateScheduler({ autoCheck: () => false, check })
    scheduler.start()
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 2)
    expect(check).not.toHaveBeenCalled()
    await expect(scheduler.checkNow()).resolves.toBe("done")
  })

  it("检查进行中时再次检查得到同一个结果", async () => {
    let finish: (value: string) => void = () => undefined
    const check = vi.fn(() => new Promise<string>((resolve) => (finish = resolve)))
    const scheduler = createUpdateScheduler({ autoCheck: () => false, check })
    const first = scheduler.checkNow()
    const second = scheduler.checkNow()
    finish("once")
    await expect(Promise.all([first, second])).resolves.toEqual(["once", "once"])
    expect(check).toHaveBeenCalledTimes(1)
  })
})
