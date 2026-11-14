// 验证退出流程的接线：确认通过并清理完成后才执行最后一步，用户取消退出时通知调用方且不清理。
import { beforeEach, describe, expect, it, vi } from "vitest"
import { installQuitFlow } from "./quit-flow"
import { UnsavedFiles } from "./workbench/unsaved-files"

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (event: { preventDefault(): void }) => void>(),
  answer: "leave" as "leave" | "stay",
}))

vi.mock("electron", () => ({
  app: {
    on: (name: string, handler: (event: { preventDefault(): void }) => void) =>
      electron.handlers.set(name, handler),
    quit: vi.fn(),
  },
}))

vi.mock("./quit-prompt", () => ({
  askToLeave: async () => electron.answer,
  askBeforeReload: vi.fn(),
  showQuitFailure: vi.fn(),
}))

function setup() {
  const calls = {
    shutdown: vi.fn(async () => undefined),
    finishQuit: vi.fn(),
    onCancel: vi.fn(),
    onBeforeShutdown: vi.fn(),
  }
  installQuitFlow({
    pendingWork: () => ({ turns: 1, approvals: 0 }),
    unsaved: new UnsavedFiles(),
    mainWindow: () => null,
    ...calls,
  })
  const beforeQuit = electron.handlers.get("before-quit")
  if (!beforeQuit) throw new Error("before-quit handler missing")
  return { calls, quit: () => beforeQuit({ preventDefault: () => undefined }) }
}

describe("退出流程", () => {
  beforeEach(() => electron.handlers.clear())

  it("确认离开后先清理，清理完成才执行最后一步", async () => {
    electron.answer = "leave"
    const { calls, quit } = setup()
    quit()
    await vi.waitFor(() => expect(calls.finishQuit).toHaveBeenCalledTimes(1))
    expect(calls.shutdown).toHaveBeenCalledTimes(1)
    expect(calls.onCancel).not.toHaveBeenCalled()
    expect(calls.shutdown.mock.invocationCallOrder[0]).toBeLessThan(
      calls.finishQuit.mock.invocationCallOrder[0] ?? 0,
    )
  })

  it("用户取消退出时通知调用方，不清理也不执行最后一步", async () => {
    electron.answer = "stay"
    const { calls, quit } = setup()
    quit()
    await vi.waitFor(() => expect(calls.onCancel).toHaveBeenCalledTimes(1))
    expect(calls.shutdown).not.toHaveBeenCalled()
    expect(calls.finishQuit).not.toHaveBeenCalled()
  })
})
