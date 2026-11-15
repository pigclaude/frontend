// 验证退出流程的接线：确认通过并清理完成后才执行最后一步，用户取消退出时通知调用方且不清理。
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { BrowserWindow } from "electron"
import { createMainWindowVisibility } from "./main-window-visibility"
import { installQuitFlow } from "./quit-flow"
import { askBeforeReload } from "./quit-prompt"
import { UnsavedFiles } from "./workbench/unsaved-files"

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (event: { preventDefault(): void }) => void>(),
  answer: "leave" as "leave" | "stay" | Promise<"leave" | "stay">,
  ask: vi.fn(),
}))

vi.mock("electron", () => ({
  app: {
    on: (name: string, handler: (event: { preventDefault(): void }) => void) =>
      electron.handlers.set(name, handler),
    quit: vi.fn(),
  },
}))

vi.mock("./quit-prompt", () => ({
  askToLeave: async () => {
    electron.ask()
    return electron.answer
  },
  askBeforeReload: vi.fn(),
  showQuitFailure: vi.fn(),
}))

function fakeWindow() {
  const closeEvents = new Map<string, (event: { preventDefault(): void }) => void>()
  const on = (name: string, handler: (event: { preventDefault(): void }) => void) =>
    closeEvents.set(name, handler)
  const window = {
    on,
    hide: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    restore: vi.fn(),
    close: vi.fn(),
    isDestroyed: () => false,
    isMinimized: () => false,
    webContents: {
      on: vi.fn<typeof on>(),
      reload: vi.fn(),
      isDestroyed: () => false,
      send: vi.fn(),
    },
  }
  return { window, closeEvents }
}

function setup(background?: {
  ui: ReturnType<typeof fakeWindow>
  closeToTray: boolean
  pendingTurns?: number
}) {
  const calls = {
    shutdown: vi.fn(async () => undefined),
    finishQuit: vi.fn(),
    onCancel: vi.fn(),
    onBeforeShutdown: vi.fn(),
    onShutdownFailure: vi.fn(),
  }
  const unsaved = new UnsavedFiles()
  const window = (background?.ui.window ?? null) as unknown as BrowserWindow | null
  let systemShutdown: ((event: { preventDefault(): void }) => void) | undefined
  const guard = installQuitFlow({
    pendingWork: () => ({ turns: background?.pendingTurns ?? 1, approvals: 0 }),
    unsaved,
    mainWindow: () => window,
    closeToTray: () => background?.closeToTray ?? false,
    watchPowerShutdown: (handler: (event: { preventDefault(): void }) => void) => {
      systemShutdown = handler
    },
    ...calls,
  })
  if (window) {
    guard(window)
    unsaved.report(window.webContents, 1)
  }
  const beforeQuit = electron.handlers.get("before-quit")
  if (!beforeQuit) throw new Error("before-quit handler missing")
  return {
    calls,
    unsaved,
    quit: () => beforeQuit({ preventDefault: () => undefined }),
    powerShutdown: (event: { preventDefault(): void }) => systemShutdown?.(event),
  }
}

describe("退出流程", () => {
  beforeEach(() => {
    electron.handlers.clear()
    electron.ask.mockClear()
    electron.answer = "leave"
    vi.mocked(askBeforeReload).mockClear()
  })

  it("启用后台运行时，关窗隐藏窗口并保留工作和未保存文件", () => {
    const ui = fakeWindow()
    const { calls, unsaved } = setup({ ui, closeToTray: true })
    const preventDefault = vi.fn()

    ui.closeEvents.get("close")?.({ preventDefault })

    expect(preventDefault).toHaveBeenCalledOnce()
    expect(ui.window.hide).toHaveBeenCalledOnce()
    expect(electron.ask).not.toHaveBeenCalled()
    expect(unsaved.count()).toBe(1)
    expect(calls.shutdown).not.toHaveBeenCalled()

    const reload = ui.window.webContents.on.mock.calls.find(
      ([name]) => name === "will-prevent-unload",
    )?.[1]
    const allowUnload = vi.fn()
    reload?.({ preventDefault: allowUnload })
    expect(askBeforeReload).toHaveBeenCalledWith(ui.window, 1)
    expect(allowUnload).not.toHaveBeenCalled()
  })

  it.each(["powerMonitor", "windows"] as const)(
    "%s 系统退出在普通退出等待回答时也立即清理",
    async (source) => {
      const ui = fakeWindow()
      const { calls, quit, powerShutdown } = setup({ ui, closeToTray: true })
      let answer: (value: "stay") => void = () => undefined
      electron.answer = new Promise((resolve) => {
        answer = resolve
      })

      quit()
      expect(ui.window.show).toHaveBeenCalledBefore(electron.ask)
      expect(calls.shutdown).not.toHaveBeenCalled()

      const event = { preventDefault: vi.fn() }
      if (source === "powerMonitor") powerShutdown(event)
      else ui.closeEvents.get("session-end")?.(event)
      expect(event.preventDefault).toHaveBeenCalledTimes(source === "powerMonitor" ? 1 : 0)
      await vi.waitFor(() => expect(calls.finishQuit).toHaveBeenCalledWith("system"))
      expect(calls.shutdown).toHaveBeenCalledOnce()

      answer("stay")
      await Promise.resolve()
      expect(electron.ask).toHaveBeenCalledOnce()
      expect(calls.onCancel).not.toHaveBeenCalled()
    },
  )

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

  it("Windows 确认注销后立即开始清理，重复事件不再次清理或拦截注销", async () => {
    const ui = fakeWindow()
    const { calls } = setup({ ui, closeToTray: true })
    const event = { preventDefault: vi.fn() }
    ui.closeEvents.get("query-session-end")?.(event)
    expect(calls.shutdown).not.toHaveBeenCalled()
    const confirmed = ui.closeEvents.get("session-end")
    expect(confirmed).toBeDefined()
    confirmed?.(event)
    confirmed?.(event)
    expect(calls.shutdown).toHaveBeenCalledOnce()
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(electron.ask).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(calls.finishQuit).toHaveBeenCalledWith("system"))
    expect(calls.finishQuit).toHaveBeenCalledOnce()
  })

  it("退出清理失败时恢复窗口操作，并可由退出菜单重试", async () => {
    const ui = fakeWindow()
    const { calls, quit, unsaved } = setup({ ui, closeToTray: true, pendingTurns: 0 })
    unsaved.report(ui.window.webContents, 0)
    const visibility = createMainWindowVisibility(() => ui.window, vi.fn())
    calls.onBeforeShutdown.mockImplementation(visibility.startShutdown)
    calls.onShutdownFailure.mockImplementation(visibility.shutdownFailed)
    calls.shutdown.mockRejectedValueOnce(new Error("资源尚未关闭"))
    quit()
    await vi.waitFor(() => expect(calls.onShutdownFailure).toHaveBeenCalledOnce())
    expect(electron.ask).not.toHaveBeenCalled()
    expect(ui.window.show).toHaveBeenCalledOnce()
    expect(calls.finishQuit).not.toHaveBeenCalled()
    quit()
    await vi.waitFor(() => expect(calls.finishQuit).toHaveBeenCalledWith("normal"))
    expect(calls.shutdown).toHaveBeenCalledTimes(2)
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
