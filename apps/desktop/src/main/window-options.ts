// 负责主窗口的尺寸、标题栏和预加载路径。
import type { BrowserWindowConstructorOptions } from "electron"

/** 开发时返回渲染进程地址；打包后不走开发服务器。 */
export function developmentRendererUrl(
  isPackaged: boolean,
  url: string | undefined,
): string | undefined {
  return isPackaged ? undefined : url
}

/** 窗口原生材质可以跟随的外观。 */
export type ThemeSource = "light" | "dark" | "system"

/** 校验渲染进程传来的外观；不认识的值返回 null，主进程忽略它。 */
export function readThemeSource(value: unknown): ThemeSource | null {
  return value === "light" || value === "dark" || value === "system" ? value : null
}

/**
 * 磨砂窗口在当前外观下的底色。macOS 浅色完全透明，深色叠 25% 黑让材质压暗；
 * Windows 的 mica 自带明暗，底色保持透明。其他系统没有磨砂材质，返回 null。
 */
export function glassBackgroundColor(platform: NodeJS.Platform, dark: boolean): string | null {
  if (platform === "darwin") return dark ? "#40000000" : "#00FFFFFF"
  if (platform === "win32") return "#00000000"
  return null
}

/** 按系统生成主窗口选项。macOS 使用隐藏标题栏和磨砂材质，交通灯与侧栏顶部按钮垂直居中。 */
export function createMainWindowOptions({
  platform,
  preloadPath,
  isPackaged,
}: {
  platform: NodeJS.Platform
  preloadPath: string
  isPackaged: boolean
}): BrowserWindowConstructorOptions {
  const options = {
    width: 1200,
    height: 800,
    show: false,
    backgroundColor: "#F4F4F5",
    autoHideMenuBar: true,
    title: "pigclaude",
    webPreferences: { preload: preloadPath, sandbox: false, devTools: !isPackaged },
  } satisfies BrowserWindowConstructorOptions
  if (platform === "darwin") {
    return {
      ...options,
      backgroundColor: glassBackgroundColor(platform, false) ?? options.backgroundColor,
      vibrancy: "sidebar",
      visualEffectState: "active",
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 16, y: 12 },
    }
  }
  if (platform === "win32") {
    return {
      ...options,
      backgroundColor: glassBackgroundColor(platform, false) ?? options.backgroundColor,
      backgroundMaterial: "mica",
      titleBarStyle: "hidden",
      titleBarOverlay: { height: 40, color: "#00000000", symbolColor: "#52525B" },
    }
  }
  return options
}
