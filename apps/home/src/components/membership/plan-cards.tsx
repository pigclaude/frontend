// 负责沿用 Pigcursor 套餐网格，以精确金额展示真实会员方案。
import { Check, Infinity as InfinityIcon } from "lucide-react"
import type { PlanItem } from "@pigclaude/api/home/types"
import { formatFen } from "@pigclaude/web-ui/lib/format"
import { cn } from "@pigclaude/web-ui/lib/utils"

/** 按原站卡片层级展示套餐，尚无购买契约时不生成购买按钮。 */
export function PlanCards({ plans }: { plans: PlanItem[] }) {
  if (plans.length === 0) return <p className="query-state">暂无可用套餐</p>
  return (
    <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(230px,1fr))]">
      {plans.map((plan) => (
        <article
          key={plan.id}
          className={cn(
            "relative flex flex-col gap-4 rounded-[var(--radius-lg)] border border-border bg-[var(--card-bg)] p-5 shadow-[var(--card-shadow)]",
            plan.lifetime &&
              "border-[var(--accent)] shadow-[0_0_0_1px_var(--accent),0_14px_40px_color-mix(in_oklab,var(--accent),transparent_84%)]",
          )}
        >
          {plan.lifetime && (
            <span className="absolute top-3.5 right-3.5 rounded-full bg-[var(--accent)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--accent-on)]">
              永久会员
            </span>
          )}
          <div>
            <h3 className="text-[17px] font-semibold text-foreground">{plan.name}</h3>
            <p className="mt-4 flex flex-wrap items-baseline gap-2">
              <strong className="text-[36px] leading-none font-semibold tracking-tight text-foreground tabular-nums">
                {formatFen(plan.priceFen)}
              </strong>
              <span className="text-xs text-[var(--meta)]">
                {plan.lifetime ? "永久有效" : `${plan.durationDays} 天`}
              </span>
            </p>
          </div>
          <ul className="mt-2 flex flex-1 flex-col gap-2 text-sm text-[var(--fg-2)]">
            {plan.description
              .split("\n")
              .map((line) => line.trim())
              .filter(Boolean)
              .map((line) => (
                <li key={line} className="flex gap-2">
                  <Check className="mt-0.5 size-4 flex-none text-[var(--accent-ink)]" aria-hidden />
                  <span>{line}</span>
                </li>
              ))}
            {plan.lifetime && (
              <li className="flex gap-2">
                <InfinityIcon
                  className="mt-0.5 size-4 flex-none text-[var(--accent-ink)]"
                  aria-hidden
                />
                <span>无需按周期续期</span>
              </li>
            )}
          </ul>
        </article>
      ))}
    </div>
  )
}
