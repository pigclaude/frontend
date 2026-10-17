// 负责展示当前用户和会员摘要。
"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { Button } from "@pigclaude/web-ui/components/button"
import { homeApi } from "@/lib/api"
import { QueryEmpty, QueryError, QueryLoading } from "@/components/query-state"

/** 读取 user/me 与 entitlement，并保留 loading、empty、error、retry 语义。 */
export default function DashboardPage() {
  const me = useQuery({ queryKey: ["me"], queryFn: homeApi.user.me })
  const entitlement = useQuery({
    queryKey: ["entitlement"],
    queryFn: homeApi.membership.entitlement,
  })
  if (me.isPending || entitlement.isPending)
    return (
      <main className="page-shell">
        <QueryLoading label="正在读取账户…" />
      </main>
    )
  if (me.isError)
    return (
      <main className="page-shell">
        <QueryError error={me.error} onRetry={() => void me.refetch()} />
      </main>
    )
  if (entitlement.isError)
    return (
      <main className="page-shell">
        <QueryError error={entitlement.error} onRetry={() => void entitlement.refetch()} />
      </main>
    )
  if (!me.data)
    return (
      <main className="page-shell">
        <QueryEmpty label="暂无账户信息" />
      </main>
    )
  const membership = entitlement.data
  return (
    <main className="page-shell">
      <h1 className="page-title">账户概览</h1>
      <div className="card-grid">
        <section className="home-card">
          <h2>{me.data.nickname || "PigClaude 用户"}</h2>
          <p className="muted">{me.data.email}</p>
          <dl className="data-list">
            <div>
              <dt>用户 ID</dt>
              <dd>{me.data.id}</dd>
            </div>
            <div>
              <dt>产品</dt>
              <dd>{me.data.productCode}</dd>
            </div>
          </dl>
        </section>
        <section className="home-card">
          <h2>会员权益</h2>
          <p>
            {membership.status === "active"
              ? "会员有效"
              : membership.status === "expired"
                ? "会员已过期"
                : "当前没有有效会员"}
          </p>
          <p className="muted">
            {membership.validUntil
              ? `有效期至 ${membership.validUntil}`
              : membership.lifetime
                ? "永久会员"
                : ""}
          </p>
          <Button asChild variant="outline">
            <Link href="/membership">查看会员</Link>
          </Button>
        </section>
      </div>
    </main>
  )
}
