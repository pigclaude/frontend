// 验证主窗口按系统选择标题栏与材质、有最小宽度、在沙箱里运行，并只接受已知的外观值和标题栏颜色。
import { describe, expect, it } from "vitest"
import {
  MIN_WINDOW_WIDTH,
  createMainWindowOptions,
  defaultTitleBarColors,
  glassBackgroundColor,
  readThemeSource,
  readTitleBarColors,
  windowBackground,
  windowMaterial,
} from "./window-options"

describe("window options", () => {
  it("macOS 窗口透明、使用常亮的磨砂材质，交通灯落在侧栏顶行", () => {
    const options = createMainWindowOptions({
      platform: "darwin",
      preloadPath: "/preload.js",
      isPackaged: true,
    })
    expect(options.backgroundColor).toBe("#00FFFFFF")
    expect(options.vibrancy).toBe("sidebar")
    expect(options.visualEffectState).toBe("active")
    expect(options.titleBarStyle).toBe("hiddenInset")
    expect(options.trafficLightPosition).toEqual({ x: 14, y: 12 })
  })

  it("Windows 使用 mica 材质，系统窗口按钮以 36px 高的 overlay 叠在自绘标题栏上", () => {
    const options = createMainWindowOptions({
      platform: "win32",
      preloadPath: "/preload.js",
      isPackaged: true,
    })
    expect(options.backgroundMaterial).toBe("mica")
    expect(options.backgroundColor).toBe("#00000000")
    expect(options.titleBarStyle).toBe("hidden")
    expect(options.titleBarOverlay).toMatchObject({ height: 36 })
  })

  it("Linux 同样隐藏系统标题栏，标题栏底色取默认主题的窗口色", () => {
    const options = createMainWindowOptions({
      platform: "linux",
      preloadPath: "/preload.js",
      isPackaged: true,
      dark: true,
    })
    const colors = defaultTitleBarColors(true)
    expect(colors).not.toBeNull()
    expect(options.titleBarStyle).toBe("hidden")
    expect(options.titleBarOverlay).toEqual({ ...colors, height: 36 })
    expect(options.backgroundColor).toBe(colors?.color)
  })

  it("各系统的主窗口都不能窄于 640px", () => {
    expect(MIN_WINDOW_WIDTH).toBe(640)
    for (const platform of ["darwin", "win32", "linux"] as const) {
      const options = createMainWindowOptions({ platform, preloadPath: "/p.js", isPackaged: true })
      expect(options.minWidth).toBe(640)
    }
  })

  it("各系统的主窗口都在沙箱里运行，页面拿不到 Node", () => {
    for (const platform of ["darwin", "win32", "linux"] as const) {
      const options = createMainWindowOptions({ platform, preloadPath: "/p.js", isPackaged: false })
      expect(options.webPreferences).toMatchObject({
        preload: "/p.js",
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      })
    }
  })

  it("深色下压暗 macOS 材质，没有磨砂的系统不改底色", () => {
    expect(glassBackgroundColor("darwin", true)).toBe("#40000000")
    expect(glassBackgroundColor("darwin", false)).toBe("#00FFFFFF")
    expect(glassBackgroundColor("linux", true)).toBeNull()
  })

  it("原生标题栏使用 UI 默认主题的明暗灰阶", () => {
    expect(defaultTitleBarColors(false)).toEqual({ color: "#EDEDED", symbolColor: "#424242" })
    expect(defaultTitleBarColors(true)).toEqual({ color: "#151515", symbolColor: "#CECECE" })
  })

  it("只接受浅色、深色和跟随系统", () => {
    expect(readThemeSource("dark")).toBe("dark")
    expect(readThemeSource("system")).toBe("system")
    expect(readThemeSource("purple")).toBeNull()
    expect(readThemeSource(1)).toBeNull()
  })

  it("标题栏颜色只接受六位十六进制色", () => {
    expect(readTitleBarColors({ color: "#112233", symbolColor: "#aabbcc" })).toEqual({
      color: "#112233",
      symbolColor: "#aabbcc",
    })
    expect(readTitleBarColors({ color: "#123", symbolColor: "#aabbcc" })).toBeNull()
    expect(readTitleBarColors({ color: "#112233" })).toBeNull()
    expect(readTitleBarColors(null)).toBeNull()
  })

  it("侧栏透明时窗口完全透明并换成更透的材质，关掉时回到默认窗口色", () => {
    expect(windowBackground(true, false)).toBe("#00000000")
    expect(windowBackground(false, false)).toBe(defaultTitleBarColors(false)?.color)
    expect(windowMaterial("darwin", true)).toEqual({ vibrancy: "fullscreen-ui" })
    expect(windowMaterial("win32", false)).toEqual({ backgroundMaterial: "mica" })
    expect(windowMaterial("linux", true)).toBeNull()
  })
})
