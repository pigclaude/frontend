// 负责按当前系统材质和深浅模式同步桌面窗口底色。
import { glassBackgroundColor } from "./window-options"

type BackgroundWindow = { setBackgroundColor: (color: string) => void }

/** 把系统磨砂需要的窗口底色写入当前窗口；不支持材质时保持原样。 */
export function applyGlassBackground(
  mainWindow: BackgroundWindow | null,
  platform: NodeJS.Platform,
  dark: boolean,
): void {
  const color = glassBackgroundColor(platform, dark)
  if (color) mainWindow?.setBackgroundColor(color)
}
