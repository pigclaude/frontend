// 使用共享小卡面选择授予等级，并保留禁用理由与键盘单选导航。
import type { Tier } from "@pigclaude/api/membership/types"
import { MembershipCard, MembershipCardGroup } from "@pigclaude/web-ui/components/membership-card"
/** 等级卡仅提交所选 ID；禁用规则由当前授予意图提供。 */
export function TierRadioCards({
  tiers,
  value,
  onChange,
  disabledReason,
}: {
  tiers: Tier[]
  value: string | null
  onChange: (id: string) => void
  disabledReason: (tier: Tier) => string | null
}) {
  return (
    <MembershipCardGroup label="授予等级">
      {tiers.map((tier) => {
        const reason = disabledReason(tier)
        return (
          <MembershipCard
            key={tier.id}
            name={tier.name}
            cardStyle={tier.cardStyle}
            size="sm"
            tagline={tier.tagline}
            eyebrow={!tier.enabled ? "已下架" : undefined}
            selected={tier.id === value}
            disabled={reason !== null}
            footer={reason}
            onSelect={() => {
              if (!reason) onChange(tier.id)
            }}
          />
        )
      })}
    </MembershipCardGroup>
  )
}
