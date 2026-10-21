// 负责提供网页登录相关页面共用的手绘线性图标，统一 24 格、1.45 描边与圆角端点。
import type { JSX, SVGProps } from "react"

/** 网页线性图标的可用名称。 */
export type LineIconName =
  "google" | "github" | "monitor" | "swap" | "arrow-left" | "eye" | "eye-off"

const shapes: Record<LineIconName, JSX.Element> = {
  // 半径 7 的 300° 开口圆弧，从右上开口逆时针绕到右侧，再一笔横杠收进圆心。
  google: <path d="M15.5 5.94A7 7 0 1 0 19 12h-7" />,
  github: (
    <path d="M9 19c-4 1.2-4-2-6-2.5M15 21v-3.2a2.8 2.8 0 0 0-.8-2.2c2.6-.3 5.3-1.3 5.3-5.8a4.5 4.5 0 0 0-1.2-3.1 4.2 4.2 0 0 0-.1-3.1s-1-.3-3.2 1.2a11 11 0 0 0-5.8 0C7.0 3.3 6.0 3.6 6.0 3.6a4.2 4.2 0 0 0-.1 3.1A4.5 4.5 0 0 0 4.7 9.8c0 4.5 2.7 5.5 5.3 5.8a2.8 2.8 0 0 0-.8 2.2V21" />
  ),
  monitor: (
    <>
      <rect x="3.5" y="4.5" width="17" height="11.5" rx="2" />
      <path d="M9 20h6M12 16v4" />
    </>
  ),
  swap: <path d="M5 8h13l-3.5-3.5M19 16H6l3.5 3.5" />,
  "arrow-left": <path d="M19 12H5M11 6l-6 6 6 6" />,
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  "eye-off": (
    <>
      <path d="M4 4l16 16" />
      <path d="M10.6 6a9.5 9.5 0 0 1 1.4-.1c6 0 9.5 6.1 9.5 6.1a16 16 0 0 1-2.8 3.5M6.7 7.6A16 16 0 0 0 2.5 12S6 18.5 12 18.5a9 9 0 0 0 4-1M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </>
  ),
}

/** 渲染指定名称的线性图标；颜色跟随 currentColor，默认对读屏隐藏。 */
export function LineIcon({
  name,
  ...props
}: SVGProps<SVGSVGElement> & { name: LineIconName }): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.45}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {shapes[name]}
    </svg>
  )
}
