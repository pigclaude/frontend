// 用固定卡面色展示会员等级徽章，不受主题强调色影响。
import type { MembershipCardStyle } from "./membership-card"

/** 保留等级名称和卡面预设，供页面统一展示。 */
export function TierBadge({ name, cardStyle }: { name: string; cardStyle: MembershipCardStyle }) {
  return (
    <span className="tier-badge" data-style={cardStyle}>
      {name}
    </span>
  )
}
