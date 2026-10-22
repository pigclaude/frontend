// 负责新增后台入口的手绘线性 SVG 图标。
import type { ComponentProps } from "react"
/** 等级阶梯图标沿用 currentColor 和统一线宽，可直接接入导航。 */
export function TiersIcon(props: ComponentProps<"svg">) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M3 20h18M5 20v-6h5v6M10 14V9h5v11M15 9V4h5v16" />
    </svg>
  )
}
