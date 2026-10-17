// 负责展示 PigClaude 会员权益和套餐，过期状态明确阻断授权入口。
"use client"

import { useQuery } from "@tanstack/react-query"
import { homeApi } from "@/lib/api"
import { QueryError, QueryLoading } from "@/components/query-state"

/** 读取套餐和 entitlement，展示过期会员 gate 及可用授权入口。 */
export default function MembershipPage() {
  const entitlement = useQuery({
    queryKey: ["entitlement"],
    queryFn: homeApi.membership.entitlement,
  })
  const plans = useQuery({ queryKey: ["plans"], queryFn: homeApi.membership.plans })
  if (entitlement.isPending || plans.isPending)
    return (
      <main className="page-shell">
        <QueryLoading label="正在读取会员信息…" />
      </main>
    )
  if (entitlement.isError)
    return (
      <main className="page-shell">
        <QueryError error={entitlement.error} onRetry={() => void entitlement.refetch()} />
      </main>
    )
  if (plans.isError)
    return (
      <main className="page-shell">
        <QueryError error={plans.error} onRetry={() => void plans.refetch()} />
      </main>
    )
  const expired =
    entitlement.data.status === "expired" ||
    entitlement.data.status === "inactive" ||
    entitlement.data.status === "revoked"
  return (
    <main className="page-shell">
      <h1 className="page-title">会员</h1>
      <section className="home-card" aria-labelledby="membership-status">
        <h2 id="membership-status">当前权益</h2>
        <p>
          {expired ? "会员已过期或未激活" : entitlement.data.lifetime ? "永久会员" : "会员有效"}
        </p>
        {entitlement.data.validUntil && (
          <p className="muted">有效期至 {entitlement.data.validUntil}</p>
        )}
        {expired ? (
          <div className="status-gate" role="status">
            <strong>需要有效会员才能授权设备</strong>
            <p>请先激活会员，再从桌面客户端发起授权。</p>
          </div>
        ) : (
          <div className="status-gate" role="status">
            <strong>等待桌面客户端发起授权</strong>
            <p>请从 PigClaude 桌面客户端发起设备授权，再打开客户端提供的合法授权链接。</p>
          </div>
        )}
      </section>
      <section className="home-card" aria-labelledby="plans-title">
        <h2 id="plans-title">可用套餐</h2>
        {plans.data.items.length === 0 ? (
          <p className="muted">暂无可用套餐</p>
        ) : (
          <div className="card-grid">
            {plans.data.items.map((plan) => (
              <article key={plan.id}>
                <h3>{plan.name}</h3>
                <p className="muted">{plan.description}</p>
                <p>{plan.priceFen} 分</p>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}
