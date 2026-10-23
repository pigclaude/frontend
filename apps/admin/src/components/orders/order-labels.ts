// 负责统一订单标签、服务端筛选和状态颜色，不解释金额或游标。
import type {
  AdminOrdersQuery,
  OrderPurpose,
  OrderStatus,
  PayType,
} from "@pigclaude/api/membership/types"
/** 订单页的六种服务端筛选入口。 */
export type OrderTab = "all" | "pending" | "activated" | "expired" | "closed" | "attention"
/** 标签只产生服务端接受的状态或待处理并集条件。 */
export function tabQuery(tab: OrderTab): Pick<AdminOrdersQuery, "status" | "needsReview"> {
  return tab === "all" ? {} : tab === "attention" ? { needsReview: true } : { status: tab }
}
/** 冻结订单状态的统一中文名称。 */
export const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: "待支付",
  activated: "已生效",
  needs_review: "待处理",
  expired: "已过期",
  closed: "已关闭",
}
/** 冻结订单目的的统一中文名称。 */
export const PURPOSE_LABEL: Record<OrderPurpose, string> = {
  open: "开通",
  renew: "续费",
  upgrade: "升级",
  upgrade_remaining: "剩余升级",
}
/** 支付方式保留免费订单语义。 */
export const PAY_TYPE_LABEL: Record<PayType | "free", string> = {
  alipay: "支付宝",
  wxpay: "微信支付",
  free: "免费",
}
/** 状态颜色独立于等级卡面和主题强调色。 */
export const STATUS_TONE = {
  pending: "warn",
  activated: "success",
  needs_review: "danger",
  expired: "neutral",
  closed: "neutral",
} as const
/** 少收仅判断服务端冻结字段，不进行金额运算。 */
export function hasShortfall(value: string) {
  return !/^0+$/.test(value)
}
