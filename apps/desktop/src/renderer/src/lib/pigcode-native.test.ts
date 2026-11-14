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

  it("外部应用列表是工作台桥检测到的本机编辑器；没有工作台时不提供", async () => {
    const source = {
      ...bridge(),
      workbench: { editors: vi.fn(async () => [{ id: "cursor", name: "Cursor" }]) },
    } as unknown as PigclaudeBridge

    await expect(pigcodeNativeFrom(source).listOpenApps?.()).resolves.toEqual([
      { id: "cursor", name: "Cursor", kind: "editor", icon: null },
    ])
    expect(pigcodeNativeFrom(bridge()).listOpenApps).toBeUndefined()
  })

  it("PigClaude 没有的预览窗口在调用时拒绝", async () => {
    await expect(pigcodeNativeFrom(bridge()).previewOpen("https://example.com")).rejects.toThrow()
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
