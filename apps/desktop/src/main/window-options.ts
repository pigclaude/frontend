// 负责主窗口的尺寸、标题栏和预加载路径。
import type { BrowserWindowConstructorOptions } from "electron"

/** 开发时返回渲染进程地址；打包后不走开发服务器。 */
export function developmentRendererUrl(
  isPackaged: boolean,
  url: string | undefined,
): string | undefined {
  return isPackaged ? undefined : url
}

/** 按系统生成主窗口选项。macOS 使用隐藏标题栏，交通灯落在侧栏顶上。 */
export function createMainWindowOptions({
  platform,
  preloadPath,
  isPackaged,
}: {
  platform: NodeJS.Platform
  preloadPath: string
  isPackaged: boolean
}): BrowserWindowConstructorOptions {
  const options: BrowserWindowConstructorOptions = {
    width: 1200,
    height: 800,
    show: false,
    backgroundColor: "#F4F4F5",
    autoHideMenuBar: true,
    title: "pigclaude",
    webPreferences: { preload: preloadPath, sandbox: false, devTools: !isPackaged },
  }
  if (platform === "darwin") {
    return {
      ...options,
      backgroundColor: "#00000000",
      vibrancy: "sidebar",
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 16, y: 14 },
    }
  }
  if (platform === "win32") {
    return {
      ...options,
      titleBarStyle: "hidden",
      titleBarOverlay: { height: 40, color: "#00000000", symbolColor: "#52525B" },
    }
  }
  return options
}
