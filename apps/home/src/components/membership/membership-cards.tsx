// 展示会员等级卡及当前等级的固定卡面扫光。
import { MembershipCard, MembershipCardGroup } from "@pigclaude/web-ui/components/membership-card"
import { formatFen } from "@pigclaude/web-ui/lib/format"
import type { EntitlementResponse } from "@pigclaude/api/membership/types"
import { formatDurationSeconds, formatTime } from "@pigclaude/web-ui/lib/format"
import type { CardModel } from "./checkout-model"
/** 只允许当前在售和可购买等级进入单选状态。 */
export function MembershipCards({
  cards,
  selected,
  onSelect,
  glintSequence = 0,
  entitlement,
}: {
  entitlement?: EntitlementResponse
  glintSequence?: number
  cards: CardModel[]
  selected: string | null
  onSelect: (code: string) => void
}) {
  return (
    <MembershipCardGroup label="会员等级" layout="track">
      {cards.map((card) => (
        <MembershipCard
          key={`${card.code}:${card.role === "current" || card.role === "current-retired" ? glintSequence : 0}`}
          name={card.name}
          cardStyle={card.cardStyle}
          tagline={card.tagline}
          dimmed={selected !== null && selected !== card.code}
          selected={selected === card.code}
          disabled={card.role === "blocked" || card.role === "current-retired"}
          glint={card.role === "current" || card.role === "current-retired"}
          eyebrow={
            card.role === "current-retired"
              ? `当前等级 · 剩余 ${formatDurationSeconds(entitlement?.remainingSeconds ?? "0")}`
              : card.role === "current"
                ? `当前等级 · 剩余 ${formatDurationSeconds(entitlement?.remainingSeconds ?? "0")}`
                : undefined
          }
          price={
            card.role === "current" || card.role === "current-retired"
              ? entitlement?.validUntil
                ? `${formatTime(entitlement.validUntil).slice(0, 10)} 到期`
                : undefined
              : card.monthlyPriceFen === null
                ? undefined
                : `${formatFen(card.monthlyPriceFen)}/月`
          }
          footer={
            card.role === "current-retired"
              ? "该等级已停售，到期前权益不受影响"
              : card.blockedReason
          }
          onSelect={() => onSelect(card.code)}
        />
      ))}
    </MembershipCardGroup>
  )
}
