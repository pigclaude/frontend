// 负责以共享卡片展示服务端预览，所有金额来自响应。
import type { Tier } from "@pigclaude/api/membership/types"
import { MembershipCard } from "@pigclaude/web-ui/components/membership-card"
import { DurationCard } from "@pigclaude/web-ui/components/duration-card"
import { formatFen } from "@pigclaude/web-ui/lib/format"
/** 预览月均价直接使用服务器展示字段。 */
export function TierPreview({ tier }: { tier?: Tier }) {
  return (
    <section aria-label="用户端预览" className="space-y-3">
      <h3>用户端预览</h3>
      {tier && (
        <>
          <MembershipCard
            name={tier.name}
            cardStyle={tier.cardStyle}
            tagline={tier.tagline}
            price={`${formatFen(tier.monthlyPriceFen)}/月`}
            footer={tier.benefits.join(" · ")}
          />
          <div className="grid grid-cols-2 gap-2">
            {tier.options
              .filter((option) => option.enabled)
              .map((option, index) => (
                <DurationCard
                  key={index}
                  months={option.months}
                  priceFen={option.priceFen}
                  perMonthFen={option.perMonthFen}
                  savedFen={option.savedFen}
                  badge={option.badge}
                  selected={option.recommended}
                  disabled
                />
              ))}
          </div>
        </>
      )}
    </section>
  )
}
