// 负责等级卡片网格，与单卡动作保持相同授权边界。
import type { ComponentProps } from "react"
import { TierCard } from "./tier-card"
/** 每张卡片展示服务端值，不计算套餐金额。 */
export function TierList({
  tiers,
  ...props
}: Omit<ComponentProps<typeof TierCard>, "tier"> & {
  tiers: ComponentProps<typeof TierCard>["tier"][]
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {tiers.map((tier) => (
        <TierCard key={tier.id} tier={tier} {...props} />
      ))}
    </div>
  )
}
