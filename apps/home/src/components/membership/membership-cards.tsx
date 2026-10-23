// 展示会员等级卡及当前等级的固定卡面扫光。
import { MembershipCard, MembershipCardGroup } from "@pigclaude/web-ui/components/membership-card"
import { formatFen } from "@pigclaude/web-ui/lib/format"
import type { CardModel } from "./checkout-model"
/** 只允许当前在售和可购买等级进入单选状态。 */
export function MembershipCards({
  cards,
  selected,
  onSelect,
  glintSequence = 0,
}: {
  glintSequence?: number
  cards: CardModel[]
  selected: string | null
  onSelect: (code: string) => void
}) {
  return (
    <MembershipCardGroup label="会员等级">
      {cards.map((card) => (
        <MembershipCard
          key={`${card.code}:${card.role === "current" || card.role === "current-retired" ? glintSequence : 0}`}
          name={card.name}
          cardStyle={card.cardStyle}
          tagline={card.tagline}
          selected={selected === card.code}
          disabled={card.role === "blocked" || card.role === "current-retired"}
          glint={card.role === "current" || card.role === "current-retired"}
          eyebrow={
            card.role === "current-retired"
              ? "当前会员 · 已停售"
              : card.role === "current"
                ? "当前会员"
                : undefined
          }
          price={
            card.monthlyPriceFen === null ? undefined : `${formatFen(card.monthlyPriceFen)}/月`
          }
          footer={card.blockedReason}
          onSelect={() => onSelect(card.code)}
        />
      ))}
    </MembershipCardGroup>
  )
}
