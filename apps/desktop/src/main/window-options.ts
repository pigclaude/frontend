// 负责主窗口的尺寸、标题栏和预加载路径，以及原生标题栏配色与侧栏透明时的窗口材质。
// 标题栏与交通灯的尺寸和 Pigcode 外壳一致：窗口按钮全部由系统绘制，页面只画按钮旁边的外壳。
import type { BrowserWindowConstructorOptions } from "electron"
import tokensCss from "@pigclaude/pigcode-ui-primitives/styles/tokens.css?raw"
import {
  clearWindowColor,
  parseCssColor,
  titleBarColors,
  tokenBlock,
  tokenReader,
} from "@pigclaude/pigcode-ui-primitives/theme-tokens"

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

/** Windows/Linux 自绘标题栏的高度；原生窗口按钮与它等高。 */
export const TITLE_BAR_HEIGHT = 36

/** macOS 交通灯的位置：竖直居中在 40px 高的侧栏顶行里。 */
export const TRAFFIC_LIGHT_POSITION = { x: 14, y: 12 }

/** 主窗口最小宽度，与设置页 640px 的窄窗口断点对齐。 */
export const MIN_WINDOW_WIDTH = 640

/** 标题栏底色与原生窗口按钮的图标色，都是 6 位十六进制色。 */
export type TitleBarColors = { color: string; symbolColor: string }

const HEX_COLOR = /^#[0-9a-f]{6}$/i

/**
 * 页面上报外观之前使用的颜色：打包进来的 tokens.css 里默认主题的 --window 与 --fg-2，
 * 和页面上报时同一套 token 与取色规则。解析不了时返回 null，窗口先用系统默认颜色。
 */
export function defaultTitleBarColors(dark: boolean): TitleBarColors | null {
  const tokens = tokenReader(tokenBlock(tokensCss, dark ? "dark" : "light"))
  return titleBarColors(tokens, parseCssColor)
}

/** 校验渲染进程上报的标题栏颜色；只接受 6 位十六进制色，其他输入返回 null。 */
export function readTitleBarColors(value: unknown): TitleBarColors | null {
  if (typeof value !== "object" || value === null) return null
  const { color, symbolColor } = value as Record<string, unknown>
  if (typeof color !== "string" || typeof symbolColor !== "string") return null
  if (!HEX_COLOR.test(color) || !HEX_COLOR.test(symbolColor)) return null
  return { color, symbolColor }
}

/** Windows 与 Linux 隐藏系统标题栏，原生窗口按钮以 overlay 的形式叠在自绘标题栏上。 */
export function usesTitleBarOverlay(platform: NodeJS.Platform): boolean {
  return platform === "win32" || platform === "linux"
}

/**
 * 侧栏透明时换用的系统材质：macOS 用 fullscreen-ui 透出背后的颜色，Windows 用比 mica 更透的 acrylic；
 * 关掉透明时换回创建窗口时的材质。其他系统没有材质，返回 null。
 */
export function windowMaterial(
  platform: NodeJS.Platform,
  translucent: boolean,
): { vibrancy: "sidebar" | "fullscreen-ui" } | { backgroundMaterial: "mica" | "acrylic" } | null {
  if (platform === "darwin") return { vibrancy: translucent ? "fullscreen-ui" : "sidebar" }
  if (platform === "win32") return { backgroundMaterial: translucent ? "acrylic" : "mica" }
  return null
}

/**
 * 侧栏透明时窗口底色完全透明，否则是默认主题的窗口色（解析不了 tokens.css 时也透明）。
 * 透明必须用八位十六进制：Electron 把 "transparent" 解析成白色，磨砂材质会被白底挡住。
 */
export function windowBackground(translucent: boolean, dark: boolean): string {
  if (translucent) return clearWindowColor
  return defaultTitleBarColors(dark)?.color ?? clearWindowColor
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

/**
 * 按系统生成主窗口选项。macOS 保留原生交通灯并移到侧栏顶行，使用磨砂材质；
 * Windows/Linux 隐藏系统标题栏，最小化、最大化与关闭按钮以 overlay 叠在自绘标题栏上。
 */
export function createMainWindowOptions({
  platform,
  preloadPath,
  isPackaged,
  dark = false,
}: {
  platform: NodeJS.Platform
  preloadPath: string
  isPackaged: boolean
  dark?: boolean
}): BrowserWindowConstructorOptions {
  const initial = defaultTitleBarColors(dark)
  const options = {
    width: 1200,
    height: 800,
    minWidth: MIN_WINDOW_WIDTH,
    show: false,
    backgroundColor: initial?.color ?? "#F4F4F5",
    autoHideMenuBar: true,
    title: "pigclaude",
    webPreferences: { preload: preloadPath, sandbox: false, devTools: !isPackaged },
  } satisfies BrowserWindowConstructorOptions
  if (platform === "darwin") {
    return {
      ...options,
      backgroundColor: glassBackgroundColor(platform, dark) ?? options.backgroundColor,
      vibrancy: "sidebar",
      visualEffectState: "active",
      titleBarStyle: "hiddenInset",
      trafficLightPosition: TRAFFIC_LIGHT_POSITION,
    }
  }
  if (usesTitleBarOverlay(platform)) {
    return {
      ...options,
      ...(platform === "win32"
        ? {
            backgroundColor: glassBackgroundColor(platform, dark) ?? options.backgroundColor,
            backgroundMaterial: "mica" as const,
          }
        : {}),
      titleBarStyle: "hidden",
      titleBarOverlay: { ...initial, height: TITLE_BAR_HEIGHT },
    }
  }
  return options
}
