// 负责沿用原首页的价格分区，从真实套餐查询呈现价格与重试状态。
"use client"

import { useQuery } from "@tanstack/react-query"
import { homeApi } from "@/lib/api"
import { PlanCards } from "@/components/membership/plan-cards"
import { QueryError, QueryLoading } from "@/components/query-state"

/** 让公开首页与会员页共享真实套餐缓存和精确价格展示。 */
export function Pricing() {
  const plans = useQuery({ queryKey: ["plans"], queryFn: homeApi.membership.plans })
  return (
    <section id="pricing" className="landing-section scroll-mt-16">
      <div className="landing-container">
        <div className="landing-pricing-head">
          <span className="landing-eyebrow">会员权益</span>
          <h2 className="landing-h2">选择适合你的使用节奏。</h2>
          <p className="landing-lede">从短期体验到长期使用，会员权益始终与你的账户相连。</p>
        </div>
        <div className="mt-14">
          {plans.isPending ? (
            <QueryLoading label="正在读取套餐…" />
          ) : plans.isError ? (
            <QueryError error={plans.error} onRetry={() => void plans.refetch()} />
          ) : (
            <PlanCards plans={plans.data.items} />
          )}
        </div>
      </div>
    </section>
  )
}
