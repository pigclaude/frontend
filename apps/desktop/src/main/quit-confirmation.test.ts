// 负责验证退出和关闭主窗口前的确认：没有要中断的工作直接放行，有工作时先问，取消就保持原样。
import { describe, expect, it, vi } from "vitest"
import { createQuitConfirmation, type GuardedWindow } from "./quit-confirmation"
import type { SessionPendingWork } from "./session/session-host-support"

const nothingPending: SessionPendingWork = { turns: 0, approvals: 0 }

describe("createQuitConfirmation", () => {
  it("lets the quit and the window close go ahead at once when nothing is pending", () => {
    const ask = vi.fn(async () => false)
    const confirmation = createQuitConfirmation({ pendingWork: () => nothingPending, ask })
    const window = fakeWindow()
    confirmation.guardClose(window)

    expect(confirmation.confirm("quit")).toBe(true)
    expect(window.requestClose()).toBe("closed")
    expect(ask).not.toHaveBeenCalled()
  })

  it("keeps the window open when the user cancels closing it during a turn", async () => {
    const work: SessionPendingWork = { turns: 1, approvals: 1 }
    const ask = vi.fn(async () => false)
    const confirmation = createQuitConfirmation({ pendingWork: () => work, ask })
    const window = fakeWindow()
    confirmation.guardClose(window)

    expect(window.requestClose()).toBe("kept")
    await vi.waitFor(() => expect(ask).toHaveBeenCalledWith(work, "close"))
    await Promise.resolve()
    expect(window.closes).toBe(0)
    expect(window.isDestroyed()).toBe(false)
  })

  it("closes the window once the user confirms, without asking twice", async () => {
    const ask = vi.fn(async () => true)
    const confirmation = createQuitConfirmation({
      pendingWork: () => ({ turns: 1, approvals: 0 }),
      ask,
    })
    const window = fakeWindow()
    confirmation.guardClose(window)

    expect(window.requestClose()).toBe("kept")

    await vi.waitFor(() => expect(window.isDestroyed()).toBe(true))
    expect(window.closes).toBe(1)
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it("asks once when the quit and the window close come together", async () => {
    const answer: { give: (leave: boolean) => void } = { give: () => undefined }
    const ask = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          answer.give = resolve
        }),
    )
    const confirmation = createQuitConfirmation({
      pendingWork: () => ({ turns: 0, approvals: 2 }),
      ask,
    })
    const window = fakeWindow()
    confirmation.guardClose(window)

    expect(window.requestClose()).toBe("kept")
    const quit = confirmation.confirm("quit")
    answer.give(false)

    await expect(quit).resolves.toBe(false)
    expect(ask).toHaveBeenCalledTimes(1)
    expect(window.isDestroyed()).toBe(false)
  })

  it("lets the user leave when the question itself fails", async () => {
    const confirmation = createQuitConfirmation({
      pendingWork: () => ({ turns: 1, approvals: 0 }),
      ask: async () => {
        throw new Error("dialog unavailable")
      },
    })

    await expect(confirmation.confirm("quit")).resolves.toBe(true)
  })
})

type FakeWindow = GuardedWindow & { requestClose(): "closed" | "kept"; closes: number }

/** 照 Electron 的顺序：close() 再发一次 close 事件，没人阻止才算关掉。 */
function fakeWindow(): FakeWindow {
  const listeners: Parameters<GuardedWindow["on"]>[1][] = []
  let destroyed = false
  const window: FakeWindow = {
    closes: 0,
    on(_event, listener) {
      listeners.push(listener)
      return window
    },
    close() {
      window.closes += 1
      window.requestClose()
    },
    isDestroyed: () => destroyed,
    requestClose() {
      let prevented = false
      for (const listener of listeners) listener({ preventDefault: () => (prevented = true) })
      if (!prevented) destroyed = true
      return prevented ? "kept" : "closed"
    },
  }
  return window
}
