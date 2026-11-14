// 验证更新 IPC：只服务受信任的主窗口，开关只收布尔值，发布页不接受页面传来的地址。
import type { IpcMainInvokeEvent } from "electron"
import { describe, expect, it, vi } from "vitest"
import { registerUpdateIpc } from "./update-ipc"
import type { UpdateService } from "./update-service"

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

function setup(trusted: boolean) {
  const handlers = new Map<string, Handler>()
  const state = { autoCheck: true, phase: "idle", currentVersion: "1.0.0" }
  const service = {
    getState: vi.fn(() => state),
    perform: vi.fn(async () => state),
    checkNow: vi.fn(async () => ({ status: "up-to-date" })),
    setAutoCheck: vi.fn(async () => state),
    openReleaseNotes: vi.fn(async () => undefined),
  } as unknown as UpdateService
  registerUpdateIpc({
    ipcMain: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) },
    service: () => service,
    isTrusted: () => trusted,
  } as unknown as Parameters<typeof registerUpdateIpc>[0])
  const invoke = (channel: string, ...args: unknown[]) =>
    handlers.get(channel)?.({} as IpcMainInvokeEvent, ...args)
  return { invoke, service, state }
}

describe("更新 IPC", () => {
  it("受信任的主窗口可以读取、执行、检查、改开关和打开发布页", async () => {
    const { invoke, service, state } = setup(true)
    expect(invoke("pigclaude:update-state")).toBe(state)
    await expect(invoke("pigclaude:update-action")).resolves.toBe(state)
    await expect(invoke("pigclaude:update-check")).resolves.toEqual({ status: "up-to-date" })
    await invoke("pigclaude:update-auto-check", false)
    expect(service.setAutoCheck).toHaveBeenCalledWith(false)
    await invoke("pigclaude:update-auto-check", "false")
    expect(service.setAutoCheck).toHaveBeenCalledTimes(1)
    await invoke("pigclaude:update-release-notes", "https://example.com")
    expect(service.openReleaseNotes).toHaveBeenCalledWith()
  })

  it("不受信任的发送者什么都做不了", async () => {
    const { invoke, service } = setup(false)
    expect(invoke("pigclaude:update-state")).toBeNull()
    await expect(invoke("pigclaude:update-action")).resolves.toBeNull()
    await expect(invoke("pigclaude:update-check")).resolves.toEqual({ status: "error" })
    await invoke("pigclaude:update-auto-check", false)
    await invoke("pigclaude:update-release-notes")
    expect(service.perform).not.toHaveBeenCalled()
    expect(service.setAutoCheck).not.toHaveBeenCalled()
    expect(service.openReleaseNotes).not.toHaveBeenCalled()
  })
})
