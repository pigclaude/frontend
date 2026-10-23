// 展示服务端时长报价，不在浏览器重新计算价格或优惠。
import type { ReactNode } from "react"
import { formatFen } from "../lib/format"
import { MembershipCardGroup } from "./membership-card"

/** 时长选项共享会员单选组的焦点与方向键合同。 */
export function DurationCardGroup(props: { label: string; children: ReactNode }) {
  return <MembershipCardGroup {...props} />
}

/** 原样格式化服务端三个分金额，并以单选按钮展示购买时长。 */
export function DurationCard(props: {
  months: number
  priceFen: string
  perMonthFen: string
  savedFen: string
  badge?: string | null
  selected: boolean
  disabled?: boolean
  onSelect?: () => void
}) {
  return (
    <button
      type="button"
      className="duration-card"
      role="radio"
      aria-checked={props.selected}
      aria-disabled={!!props.disabled}
      disabled={props.disabled}
      tabIndex={props.disabled ? -1 : 0}
      onClick={props.onSelect}
    >
      {props.badge && <span className="duration-card-badge">{props.badge}</span>}
      <span className="duration-card-months">{props.months} 个月</span>
      <span className="duration-card-price">{formatFen(props.priceFen)}</span>
      <span className="duration-card-monthly">{formatFen(props.perMonthFen)}/月</span>
      {props.savedFen !== "0" && (
        <span className="duration-card-saving">省 {formatFen(props.savedFen)}</span>
      )}
    </button>
  )
}
