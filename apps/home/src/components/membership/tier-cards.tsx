// 负责呈现公开等级价格和本人购买报价，金额只使用服务端字段。
import type { CatalogTier, Quotes } from "@pigclaude/api/membership/types"
import { Button } from "@pigclaude/web-ui/components/button"
import { formatDurationSeconds, formatFen } from "@pigclaude/web-ui/lib/format"
import { UpgradeOffer } from "./upgrade-offer"
/** 下单意图只表达档位或剩余升级，不包含客户端计算金额。 */
export type PurchaseIntent = { optionId: string } | { remainingUpgrade: { tierCode: string } }
/** 公开目录独立可展示；登录报价存在时才允许发起对应购买。 */
export function TierCards({
  tiers,
  quotes,
  onChoose,
}: {
  tiers: CatalogTier[]
  quotes?: Quotes
  onChoose?: (intent: PurchaseIntent) => void
}) {
  if (tiers.length === 0) return <p className="query-state">暂无可用套餐</p>
  return (
    <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(230px,1fr))]">
      {tiers.map((tier) => (
        <article
          key={tier.code}
          className="flex flex-col gap-4 rounded-[var(--radius-lg)] border border-border bg-[var(--card-bg)] p-5"
        >
          <h3 className="text-[17px] font-semibold">{tier.name}</h3>
          <p>按月购买 {formatFen(tier.monthlyPriceFen)}</p>
          <p className="text-sm">{tier.tagline}</p>
          {quotes?.remainingUpgrade?.tierCode === tier.code && onChoose && (
            <UpgradeOffer
              offer={quotes.remainingUpgrade}
              name={tier.name}
              onChoose={() => onChoose({ remainingUpgrade: { tierCode: tier.code } })}
            />
          )}
          {tier.options.map((option) => {
            const offer = quotes?.offers.find((item) => item.optionId === option.id)
            const renewal =
              quotes?.entitlement.status === "active" && quotes.entitlement.tier?.code === tier.code
            return (
              <section key={option.id} className="flex flex-col gap-2 border-t pt-3">
                <p>
                  {option.months} 个月 {formatFen(option.priceFen)}
                </p>
                {option.savedFen !== "0" && (
                  <p>
                    按月购买 {formatFen(option.monthlyPurchaseFen)} · 省{" "}
                    {formatFen(option.savedFen)}
                  </p>
                )}
                <p>折合 {formatFen(option.perMonthFen)}/月</p>
                {offer && onChoose && (
                  <Button
                    disabled={Boolean(offer.blocked)}
                    className="h-auto whitespace-normal"
                    onClick={() => onChoose({ optionId: option.id })}
                  >
                    {offer.blocked === "LOWER_TIER"
                      ? "你已是更高等级会员"
                      : offer.blocked
                        ? "暂不可购买"
                        : offer.kind === "upgrade_package"
                          ? `升级 · 抵扣 ${formatFen(offer.creditFen)} · 应付 ${formatFen(offer.payableFen)}${offer.bonusSeconds !== "0" ? ` · 另赠 ${formatDurationSeconds(offer.bonusSeconds)}` : ""}`
                          : renewal
                            ? "续费"
                            : "开通"}
                  </Button>
                )}
              </section>
            )
          })}
          <p className="text-xs text-muted-foreground">1 个月按 30 天计</p>
        </article>
      ))}
    </div>
  )
}
