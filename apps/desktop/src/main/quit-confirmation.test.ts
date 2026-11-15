// 负责验证退出和关闭主窗口前的确认：没有要中断的工作或未保存的文件直接放行，否则先问一次；
// 选保存就先保存，保存失败留下；选不保存就先放弃修改再离开；取消就保持原样。
import { describe, expect, it, vi } from "vitest"
import {
  createQuitConfirmation,
  type GuardedWindow,
  type LeaveAnswer,
  type LeaveWork,
  type QuitConfirmationOptions,
} from "./quit-confirmation"

const nothingPending: LeaveWork = { turns: 0, approvals: 0, unsavedFiles: 0 }

function confirmationWith(
  work: LeaveWork,
  ask: QuitConfirmationOptions["ask"],
  saved = true,
): {
  confirmation: ReturnType<typeof createQuitConfirmation>
  saveFiles: ReturnType<typeof vi.fn<() => Promise<boolean>>>
  discardFiles: ReturnType<typeof vi.fn<() => Promise<void>>>
} {
  const saveFiles = vi.fn(async () => saved)
  const discardFiles = vi.fn(async () => undefined)
  const confirmation = createQuitConfirmation({
    pendingWork: () => work,
    ask,
    saveFiles,
    discardFiles,
  })
  return { confirmation, saveFiles, discardFiles }
}

describe("createQuitConfirmation", () => {
  it("lets the quit and the window close go ahead at once when nothing is pending", () => {
    const ask = vi.fn(async (): Promise<LeaveAnswer> => "stay")
    const { confirmation } = confirmationWith(nothingPending, ask)
    const window = fakeWindow()
    confirmation.guardClose(window)

    expect(confirmation.confirm("quit")).toBe(true)
    expect(window.requestClose()).toBe("closed")
    expect(ask).not.toHaveBeenCalled()
  })

  it("keeps the window open when the user cancels closing it during a turn", async () => {
    const work: LeaveWork = { turns: 1, approvals: 1, unsavedFiles: 0 }
    const ask = vi.fn(async (): Promise<LeaveAnswer> => "stay")
    const { confirmation } = confirmationWith(work, ask)
    const window = fakeWindow()
    confirmation.guardClose(window)

    expect(window.requestClose()).toBe("kept")
    await vi.waitFor(() => expect(ask).toHaveBeenCalledWith(work, "close"))
    await Promise.resolve()
    expect(window.closes).toBe(0)
    expect(window.isDestroyed()).toBe(false)
  })

  it("closes the window once the user confirms, without asking twice", async () => {
    const ask = vi.fn(async (): Promise<LeaveAnswer> => "leave")
    const { confirmation } = confirmationWith({ turns: 1, approvals: 0, unsavedFiles: 0 }, ask)
    const window = fakeWindow()
    confirmation.guardClose(window)

    expect(window.requestClose()).toBe("kept")

    await vi.waitFor(() => expect(window.isDestroyed()).toBe(true))
    expect(window.closes).toBe(1)
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it("asks once when the quit and the window close come together", async () => {
    const answer: { give: (leave: LeaveAnswer) => void } = { give: () => undefined }
    const ask = vi.fn(
      () =>
        new Promise<LeaveAnswer>((resolve) => {
          answer.give = resolve
        }),
    )
    const { confirmation } = confirmationWith({ turns: 0, approvals: 2, unsavedFiles: 0 }, ask)
    const window = fakeWindow()
    confirmation.guardClose(window)

    expect(window.requestClose()).toBe("kept")
    const quit = confirmation.confirm("quit")
    answer.give("stay")

    await expect(quit).resolves.toBe(false)
    expect(ask).toHaveBeenCalledTimes(1)
    expect(window.isDestroyed()).toBe(false)
  })

  it("lets the user leave when the question itself fails", async () => {
    const { confirmation, discardFiles } = confirmationWith(
      { turns: 1, approvals: 0, unsavedFiles: 1 },
      async () => {
        throw new Error("dialog unavailable")
      },
    )

    await expect(confirmation.confirm("quit")).resolves.toBe(true)
    expect(discardFiles).not.toHaveBeenCalled()
  })

  it("asks about unsaved files together with the running turn and saves them before leaving", async () => {
    const work: LeaveWork = { turns: 1, approvals: 0, unsavedFiles: 2 }
    const ask = vi.fn(async (): Promise<LeaveAnswer> => "save")
    const { confirmation, saveFiles, discardFiles } = confirmationWith(work, ask)

    await expect(confirmation.confirm("quit")).resolves.toBe(true)

    expect(ask).toHaveBeenCalledExactlyOnceWith(work, "quit")
    expect(saveFiles).toHaveBeenCalledOnce()
    expect(discardFiles).not.toHaveBeenCalled()
  })

  it("stays when saving fails, discards before leaving without saving, and touches nothing on cancel", async () => {
    const work: LeaveWork = { turns: 0, approvals: 0, unsavedFiles: 1 }
    const failed = confirmationWith(work, async () => "save", false)
    const window = fakeWindow()
    failed.confirmation.guardClose(window)
    expect(window.requestClose()).toBe("kept")
    await vi.waitFor(() => expect(failed.saveFiles).toHaveBeenCalledOnce())
    await Promise.resolve()
    expect(window.isDestroyed()).toBe(false)

    const discarded = confirmationWith(work, async () => "leave")
    await expect(discarded.confirmation.confirm("close")).resolves.toBe(true)
    expect(discarded.discardFiles).toHaveBeenCalledOnce()
    expect(discarded.saveFiles).not.toHaveBeenCalled()

    const cancelled = confirmationWith(work, async () => "stay")
    await expect(cancelled.confirmation.confirm("quit")).resolves.toBe(false)
    expect(cancelled.saveFiles).not.toHaveBeenCalled()
    expect(cancelled.discardFiles).not.toHaveBeenCalled()
  })

  it("does not ask again for the close that follows a confirmed quit until it is reset", async () => {
    const ask = vi.fn(async (): Promise<LeaveAnswer> => "leave")
    const { confirmation } = confirmationWith({ turns: 0, approvals: 0, unsavedFiles: 1 }, ask)
    const window = fakeWindow()
    confirmation.guardClose(window)
    expect(confirmation.leaving()).toBe(false)

    await expect(confirmation.confirm("quit")).resolves.toBe(true)
    expect(confirmation.leaving()).toBe(true)
    expect(window.requestClose()).toBe("closed")
    expect(ask).toHaveBeenCalledOnce()

    confirmation.reset()
    expect(confirmation.leaving()).toBe(false)
    const next = fakeWindow()
    confirmation.guardClose(next)
    expect(next.requestClose()).toBe("kept")
    await vi.waitFor(() => expect(ask).toHaveBeenCalledTimes(2))
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
    hide() {},
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
