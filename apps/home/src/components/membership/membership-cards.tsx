// 展示会员等级卡，并在本页付款生效后为当前等级播放一次卡面扫光。
import { MembershipCard, MembershipCardGroup } from "@pigclaude/web-ui/components/membership-card"
import { formatDurationSeconds, formatFen, formatTime } from "@pigclaude/web-ui/lib/format"
import type { EntitlementResponse } from "@pigclaude/api/membership/types"
import type { CardModel } from "./checkout-model"

/** 剩余时间按整天显示，不足一天时才显示小时。 */
export function remainingLabel(seconds: string) {
  const days = BigInt(seconds) / 86400n
  return days >= 1n ? `${days} 天` : formatDurationSeconds(seconds)
}

function eyebrow(card: CardModel, entitlement?: EntitlementResponse) {
  if (card.role === "current" || card.role === "current-retired")
    return `当前等级 · 剩余 ${remainingLabel(entitlement?.remainingSeconds ?? "0")}`
  if (card.role === "blocked") return card.blockedReason ?? undefined
  const current = entitlement?.status === "active" ? entitlement.tier : null
  if (current && card.level > current.level) return "升级后立即生效"
  return undefined
}

/** 只允许当前在售和可购买等级进入单选状态；glintSequence 大于 0 才表示刚刚付款生效。 */
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
  const until = entitlement?.validUntil
    ? `${formatTime(entitlement.validUntil).slice(0, 10)} 到期`
    : undefined
  return (
    <MembershipCardGroup label="会员等级" layout="track">
      {cards.map((card) => {
        const current = card.role === "current" || card.role === "current-retired"
        return (
          <MembershipCard
            key={`${card.role}:${card.code}:${current ? glintSequence : 0}`}
            name={card.name}
            cardStyle={card.cardStyle}
            eyebrow={eyebrow(card, entitlement)}
            tagline={current ? until : card.tagline || undefined}
            footer={
              card.role === "current-retired" ? "该等级已停售，到期前权益不受影响" : undefined
            }
            price={
              card.monthlyPriceFen === null ? undefined : `${formatFen(card.monthlyPriceFen)}/月`
            }
            dimmed={selected !== null && selected !== card.code}
            selected={selected === card.code}
            disabled={card.role === "blocked" || card.role === "current-retired"}
            glint={current && glintSequence > 0}
            onSelect={() => onSelect(card.code)}
          />
        )
      })}
    </MembershipCardGroup>
  )
}
