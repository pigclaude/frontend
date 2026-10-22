// 负责机械迁移公开等级目录，展示金额全部取服务端返回值。
import type { CatalogTier } from "@pigclaude/api/membership/types"
import { formatFen } from "@pigclaude/web-ui/lib/format"

/** 展示公开等级和档位；完整购买交互由会员支付页面接线。 */
export function PlanCards({ plans }: { plans: CatalogTier[] }) {
  if (plans.length === 0) return <p className="query-state">暂无可用套餐</p>
  return (
    <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(230px,1fr))]">
      {plans.map((tier) => (
        <article
          key={tier.code}
          className="flex flex-col gap-4 rounded-[var(--radius-lg)] border border-border bg-[var(--card-bg)] p-5"
        >
          <h3 className="text-[17px] font-semibold">{tier.name}</h3>
          <p>按月购买 {formatFen(tier.monthlyPriceFen)}</p>
          <p className="text-sm">{tier.description}</p>
          {tier.options.map((option) => (
            <p key={option.id}>
              {option.months} 个月 {formatFen(option.priceFen)} · 省 {formatFen(option.savedFen)}
            </p>
          ))}
          <p className="text-xs text-muted-foreground">1 个月按 30 天计</p>
        </article>
      ))}
    </div>
  )
}
