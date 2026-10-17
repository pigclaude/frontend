// 验证主窗口在 macOS 上使用磨砂材质，并只接受已知的外观值。
import { describe, expect, it } from "vitest"
import { createMainWindowOptions, glassBackgroundColor, readThemeSource } from "./window-options"

describe("window options", () => {
  it("macOS 窗口透明并使用常亮的磨砂材质", () => {
    const options = createMainWindowOptions({
      platform: "darwin",
      preloadPath: "/preload.js",
      isPackaged: true,
    })
    expect(options.backgroundColor).toBe("#00FFFFFF")
    expect(options.vibrancy).toBe("sidebar")
    expect(options.visualEffectState).toBe("active")
    expect(options.trafficLightPosition).toEqual({ x: 16, y: 12 })
  })

  it("Windows 窗口使用 mica 材质", () => {
    const options = createMainWindowOptions({
      platform: "win32",
      preloadPath: "/preload.js",
      isPackaged: true,
    })
    expect(options.backgroundMaterial).toBe("mica")
    expect(options.backgroundColor).toBe("#00000000")
  })

  it("深色下压暗 macOS 材质，没有磨砂的系统不改底色", () => {
    expect(glassBackgroundColor("darwin", true)).toBe("#40000000")
    expect(glassBackgroundColor("darwin", false)).toBe("#00FFFFFF")
    expect(glassBackgroundColor("linux", true)).toBeNull()
  })

  it("只接受浅色、深色和跟随系统", () => {
    expect(readThemeSource("dark")).toBe("dark")
    expect(readThemeSource("system")).toBe("system")
    expect(readThemeSource("purple")).toBeNull()
    expect(readThemeSource(1)).toBeNull()
  })
})
