// 验证 Pigcode 组件读取的原生桥由 PigClaude 桌面桥生成：能力一一转给 pigclaude 桥，没有桌面桥时不安装。
import { describe, expect, it, vi } from "vitest"
import { installPigcodeNative, pigcodeNativeFrom } from "./pigcode-native"

function bridge(): PigclaudeBridge {
  return {
    platform: "win32",
    systemVersion: "10.0.22631",
    setTheme: vi.fn(async () => undefined),
    pickFolder: vi.fn(async () => "/work/demo"),
    window: {
      onNavigation: vi.fn(() => () => undefined),
      getCloseToTray: vi.fn(async () => false),
      setCloseToTray: vi.fn(async (value) => value),
      control: vi.fn(async () => undefined),
      isMaximized: vi.fn(async () => true),
      isFullScreen: vi.fn(async () => false),
      onFullScreenChange: vi.fn(() => () => undefined),
      setTitleBarColors: vi.fn(async () => undefined),
      setTranslucent: vi.fn(async () => undefined),
      popupMenu: vi.fn(async () => "settings"),
    },
  }
}

describe("pigcodeNativeFrom", () => {
  it("平台、系统版本和窗口能力都来自 PigClaude 桌面桥", async () => {
    const source = bridge()
    const native = pigcodeNativeFrom(source)
    expect(native.platform).toBe("win32")
    expect(native.systemVersion).toBe("10.0.22631")
    await native.windowControl("maximize")
    await native.setThemeSource("dark")
    await expect(native.isMaximized()).resolves.toBe(true)
    expect(source.window?.control).toHaveBeenCalledWith("maximize")
    expect(source.setTheme).toHaveBeenCalledWith("dark")
  })

  it("标题栏菜单、配色、透明和选文件夹都转给桌面桥", async () => {
    const source = bridge()
    const native = pigcodeNativeFrom(source)
    const items = [{ id: "settings", label: "设置" }]
    await expect(native.popupMenu?.(items, { x: 1, y: 2 })).resolves.toBe("settings")
    await native.setTitleBarColors?.({ color: "#ffffff", symbolColor: "#000000" })
    await native.setWindowTranslucent?.(true)
    await expect(native.pickFolder?.({ title: "选文件夹" })).resolves.toBe("/work/demo")
    expect(source.window?.popupMenu).toHaveBeenCalledWith(items, { x: 1, y: 2 })
    expect(source.window?.setTranslucent).toHaveBeenCalledWith(true)
    expect(source.pickFolder).toHaveBeenCalledWith({ title: "选文件夹" })
  })

  it("外部应用是本机的文件管理器、编辑器和终端，打开项目和文件夹都转给项目入口", async () => {
    const workspaces = {
      apps: vi.fn(async () => [
        { id: "finder", name: "Finder", kind: "file-manager" },
        { id: "cursor", name: "Cursor", kind: "editor" },
        { id: "ghostty", name: "Ghostty", kind: "terminal" },
      ]),
      openWith: vi.fn(async () => undefined),
      reveal: vi.fn(async () => undefined),
    }
    const native = pigcodeNativeFrom({ ...bridge(), workspaces } as unknown as PigclaudeBridge)

    await expect(native.listOpenApps?.()).resolves.toEqual([
      { id: "finder", name: "Finder", kind: "file-manager", icon: null },
      { id: "cursor", name: "Cursor", kind: "editor", icon: null },
      { id: "ghostty", name: "Ghostty", kind: "terminal", icon: null },
    ])
    await native.openWithApp?.("ghostty", "/work/api")
    await native.openFolder?.("/work/api")
    expect(workspaces.openWith).toHaveBeenCalledWith("/work/api", "ghostty")
    expect(workspaces.reveal).toHaveBeenCalledWith("/work/api")
    expect(pigcodeNativeFrom(bridge()).listOpenApps).toBeUndefined()
  })

  it("PigClaude 没有的预览窗口在调用时拒绝", async () => {
    await expect(pigcodeNativeFrom(bridge()).previewOpen("https://example.com")).rejects.toThrow()
  })
  it("更新中心的发布说明只能打开主进程持有的发布页，别的地址一律拒绝", async () => {
    const url = "https://github.com/pigclaude/release/releases/tag/v1.1.0"
    const updates = {
      state: vi.fn(async () => ({
        autoCheck: true,
        phase: "available" as const,
        currentVersion: "1.0.0",
        version: "1.1.0",
        url,
        action: "download" as const,
        progress: null,
        error: null,
      })),
      openReleaseNotes: vi.fn(async () => undefined),
    }
    const native = pigcodeNativeFrom({ ...bridge(), updates } as unknown as PigclaudeBridge)
    await native.openExternal?.(url)
    expect(updates.openReleaseNotes).toHaveBeenCalledTimes(1)
    await expect(native.openExternal?.("https://example.com/")).rejects.toThrow(
      "EXTERNAL_LINK_BLOCKED",
    )
    expect(updates.openReleaseNotes).toHaveBeenCalledTimes(1)
    expect(pigcodeNativeFrom(bridge()).openExternal).toBeUndefined()
  })
})

describe("installPigcodeNative", () => {
  it("没有桌面桥时不安装", () => {
    const target = {} as Window
    expect(installPigcodeNative(target)).toBe(false)
    expect(target.pigcodeNative).toBeUndefined()
  })

  it("有桌面桥时安装", () => {
    const target = { pigclaude: bridge() } as unknown as Window
    expect(installPigcodeNative(target)).toBe(true)
    expect(target.pigcodeNative?.platform).toBe("win32")
  })
})
