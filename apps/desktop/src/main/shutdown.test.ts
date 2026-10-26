// 负责验证退出协调器：等待关闭流程、重复事件不重复执行、超时强制退出，且失败也会继续退出。

import { describe, expect, it, vi } from "vitest"
import { createQuitCoordinator } from "./shutdown"

function quitEvent() {
  return { preventDefault: vi.fn() }
}

describe("createQuitCoordinator", () => {
  it("prevents the first quit, awaits shutdown and then quits", async () => {
    const finishControl = { finish: (): void => undefined }
    const shutdown = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishControl.finish = resolve
        }),
    )
    const quit = vi.fn()
    const forceExit = vi.fn()
    const onBeforeShutdown = vi.fn()
    const handle = createQuitCoordinator({ shutdown, quit, forceExit, onBeforeShutdown })
    const first = quitEvent()

    handle(first)
    expect(first.preventDefault).toHaveBeenCalledTimes(1)
    expect(onBeforeShutdown).toHaveBeenCalledTimes(1)
    expect(quit).not.toHaveBeenCalled()

    const second = quitEvent()
    handle(second)
    expect(second.preventDefault).toHaveBeenCalledTimes(1)
    expect(shutdown).toHaveBeenCalledTimes(1)

    finishControl.finish()
    await vi.waitFor(() => expect(quit).toHaveBeenCalledTimes(1))
    expect(forceExit).not.toHaveBeenCalled()

    const final = quitEvent()
    handle(final)
    expect(final.preventDefault).not.toHaveBeenCalled()
  })

  it("still quits when shutdown fails", async () => {
    const quit = vi.fn()
    const handle = createQuitCoordinator({
      shutdown: async () => {
        throw new Error("shutdown failed")
      },
      quit,
      forceExit: vi.fn(),
    })

    handle(quitEvent())
    await vi.waitFor(() => expect(quit).toHaveBeenCalledTimes(1))
  })

  it("forces exit when shutdown exceeds the bounded timeout", async () => {
    const quit = vi.fn()
    const forceExit = vi.fn()
    const handle = createQuitCoordinator({
      shutdown: () => new Promise<void>(() => undefined),
      quit,
      forceExit,
      timeoutMs: 5,
    })

    handle(quitEvent())
    await vi.waitFor(() => expect(forceExit).toHaveBeenCalledTimes(1))
    expect(quit).not.toHaveBeenCalled()
  })
})
