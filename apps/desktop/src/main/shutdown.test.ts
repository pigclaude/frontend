// 负责验证退出协调器：安全清理完成前不退出，失败或超时明确报告。

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
    const onBeforeShutdown = vi.fn()
    const onFailure = vi.fn()
    const handle = createQuitCoordinator({ shutdown, quit, onFailure, onBeforeShutdown })
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
    expect(onFailure).not.toHaveBeenCalled()

    const final = quitEvent()
    handle(final)
    expect(final.preventDefault).not.toHaveBeenCalled()
  })

  it("keeps the app open when shutdown fails and allows a retry", async () => {
    const quit = vi.fn()
    const onFailure = vi.fn()
    let attempts = 0
    const handle = createQuitCoordinator({
      shutdown: async () => {
        attempts += 1
        if (attempts === 1) throw new Error("shutdown failed")
      },
      quit,
      onFailure,
    })

    handle(quitEvent())
    await vi.waitFor(() => expect(onFailure).toHaveBeenCalledWith("failed"))
    expect(quit).not.toHaveBeenCalled()
    handle(quitEvent())
    await vi.waitFor(() => expect(quit).toHaveBeenCalledTimes(1))
  })

  it("reports a timeout without exiting while shutdown is still running", async () => {
    const quit = vi.fn()
    const onFailure = vi.fn()
    let complete: () => void = () => undefined
    const handle = createQuitCoordinator({
      shutdown: () =>
        new Promise<void>((resolve) => {
          complete = resolve
        }),
      quit,
      onFailure,
      timeoutMs: 5,
    })

    handle(quitEvent())
    await vi.waitFor(() => expect(onFailure).toHaveBeenCalledWith("timeout"))
    expect(quit).not.toHaveBeenCalled()
    handle(quitEvent())
    expect(onFailure).toHaveBeenCalledTimes(2)
    complete()
    await vi.waitFor(() => expect(quit).toHaveBeenCalledTimes(1))
  })
})
