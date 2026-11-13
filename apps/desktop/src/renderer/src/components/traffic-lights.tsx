// 负责为浏览器视觉预览绘制窗口栏占位控件。
import type { ReactElement } from "react"

/** 判断浏览器预览使用自绘交通灯，原生窗口使用系统控件。 */
export function shouldRenderCustomTraffic(platform: string | undefined): boolean {
  return platform === undefined
}

/** 在浏览器预览画交通灯占位。 */
export function TrafficLights(): ReactElement | null {
  if (!shouldRenderCustomTraffic(window.pigclaude?.platform)) return null
  return (
    <div className="traffic" aria-hidden="true">
      <i />
      <i />
      <i />
    </div>
  )
}
