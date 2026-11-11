// 验证外壳的窗口 IPC：只作用于受信任窗口，标题栏配色只在自绘标题栏的系统生效，透明只在有材质的系统生效。
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from "electron"
import { describe, expect, it, vi } from "vitest"
import type { MenuFactory } from "./native-menu"
import { forwardFullScreen, registerWindowIpc } from "./window-ipc"

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

function fakeWindow() {
  return {
    minimize: vi.fn(),
    maximize: vi.fn(),
    unmaximize: vi.fn(),
    close: vi.fn(),
    isMaximized: vi.fn(() => false),
    isFullScreen: vi.fn(() => true),
    setTitleBarOverlay: vi.fn(),
    setBackgroundColor: vi.fn(),
    setVibrancy: vi.fn(),
    setBackgroundMaterial: vi.fn(),
  }
}

function harness({
  platform = "win32" as NodeJS.Platform,
  systemVersion = "10.0.22631",
  trusted = true,
} = {}) {
  const handlers = new Map<string, Handler>()
  const window = fakeWindow()
  const popups: Array<{ x: number; y: number }> = []
  const menus: MenuFactory = {
    buildFromTemplate: () => ({
      popup: (options) => {
        popups.push({ x: options.x, y: options.y })
        options.callback()
      },
    }),
  }
  registerWindowIpc({
    ipcMain: {
      handle: (channel: string, handler: Handler) => handlers.set(channel, handler),
    } as unknown as Pick<IpcMain, "handle">,
    windows: { fromWebContents: () => window as unknown as BrowserWindow },
    nativeTheme: { shouldUseDarkColors: false },
    menus,
    platform,
    systemVersion,
    allowDevRoles: false,
    isTrusted: () => trusted,
  })
  const event = { sender: { getZoomFactor: () => 2 } } as unknown as IpcMainInvokeEvent
  const invoke = (channel: string, ...args: unknown[]) => handlers.get(channel)?.(event, ...args)
  return { window, invoke, popups }
}

describe("registerWindowIpc", () => {
  it("不受信任的页面发来的窗口操作被忽略", () => {
    const { window, invoke } = harness({ trusted: false })
    invoke("pigclaude:window", "minimize")
    expect(window.minimize).not.toHaveBeenCalled()
    expect(invoke("pigclaude:is-full-screen")).toBe(false)
  })

  it("最大化按钮在已最大化时还原窗口，未知动作不做事", () => {
    const { window, invoke } = harness()
    window.isMaximized.mockReturnValue(true)
    invoke("pigclaude:window", "maximize")
    invoke("pigclaude:window", "explode")
    expect(window.unmaximize).toHaveBeenCalledTimes(1)
    expect(window.maximize).not.toHaveBeenCalled()
    expect(invoke("pigclaude:is-full-screen")).toBe(true)
  })

  it("标题栏配色只在 Windows/Linux 生效，并且只接受六位十六进制色", () => {
    const windows = harness({ platform: "win32" })
    windows.invoke("pigclaude:title-bar", { color: "#FAFAFA", symbolColor: "#333333" })
    windows.invoke("pigclaude:title-bar", { color: "red", symbolColor: "#333333" })
    expect(windows.window.setTitleBarOverlay).toHaveBeenCalledTimes(1)
    expect(windows.window.setTitleBarOverlay).toHaveBeenCalledWith({
      color: "#FAFAFA",
      symbolColor: "#333333",
      height: 36,
    })
    const mac = harness({ platform: "darwin" })
    mac.invoke("pigclaude:title-bar", { color: "#FAFAFA", symbolColor: "#333333" })
    expect(mac.window.setTitleBarOverlay).not.toHaveBeenCalled()
  })

  it("侧栏透明时换成透明底色与更透的材质，没有材质的系统不动窗口", () => {
    const windows = harness({ platform: "win32", systemVersion: "10.0.22631" })
    windows.invoke("pigclaude:set-translucent", true)
    expect(windows.window.setBackgroundColor).toHaveBeenCalledWith("#00000000")
    expect(windows.window.setBackgroundMaterial).toHaveBeenCalledWith("acrylic")
    const oldWindows = harness({ platform: "win32", systemVersion: "10.0.19045" })
    oldWindows.invoke("pigclaude:set-translucent", true)
    const linux = harness({ platform: "linux" })
    linux.invoke("pigclaude:set-translucent", true)
    expect(oldWindows.window.setBackgroundColor).not.toHaveBeenCalled()
    expect(linux.window.setBackgroundColor).not.toHaveBeenCalled()
  })

  it("标题栏菜单按缩放换算位置弹出，菜单描述不合法时不弹出", async () => {
    const { invoke, popups } = harness()
    await expect(invoke("pigclaude:menu", [{ role: "help" }], { x: 1, y: 1 })).toBeNull()
    await invoke("pigclaude:menu", [{ id: "settings", label: "设置" }], { x: 10, y: 20 })
    expect(popups).toEqual([{ x: 20, y: 40 }])
  })
})

describe("forwardFullScreen", () => {
  it("进入和退出全屏时通知页面", () => {
    const listeners = new Map<string, () => void>()
    const send = vi.fn()
    forwardFullScreen({
      on: ((name: string, listener: () => void) => {
        listeners.set(name, listener)
      }) as unknown as BrowserWindow["on"],
      webContents: { send },
    })
    listeners.get("enter-full-screen")?.()
    listeners.get("leave-full-screen")?.()
    expect(send.mock.calls).toEqual([
      ["pigclaude:full-screen", true],
      ["pigclaude:full-screen", false],
    ])
  })
})
