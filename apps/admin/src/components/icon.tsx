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

/** 订单和支付设置共用的手绘收据图标。 */
export function OrdersIcon(props: ComponentProps<"svg">) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" />
      <path d="M9 7h6M9 11h6M9 15h3" />
    </svg>
  )
}

/** 订单复制控件使用的手绘双页图标。 */
export function OrderCopyIcon(props: ComponentProps<"svg">) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <rect x="8" y="8" width="12" height="13" rx="2" />
      <path d="M15 8V3H3v13h5" />
    </svg>
  )
}
/** 统计重试使用的手绘刷新图标。 */
export function OrderRefreshIcon(props: ComponentProps<"svg">) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M20 10a8 8 0 1 0-1 7M20 4v6h-6" />
    </svg>
  )
}
/** 少收金额旁的手绘警示图标。 */
export function OrderWarningIcon(props: ComponentProps<"svg">) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="m12 3 10 18H2L12 3ZM12 9v5M12 17h.01" />
    </svg>
  )
}
