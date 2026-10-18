// 负责展示当前用户和会员摘要。
"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { Laptop, ShieldCheck, UserRound } from "lucide-react"
import { formatFen } from "@pigclaude/web-ui/lib/format"
import { Button } from "@pigclaude/web-ui/components/button"
import { homeApi } from "@/lib/api"
import { maskEmail, maskUserId } from "@/lib/identity-mask"
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">账户概览</h1>
          <p className="mt-2 text-sm text-[var(--meta)]">
            欢迎回来，{me.data.nickname || "PigClaude 用户"}。在这里查看你的账户与会员权益。
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-[var(--fg-2)]">
          <span className="size-1.5 rounded-full bg-[var(--success)]" />
          账户正常
        </span>
      </div>
      <div className="card-grid">
        <section className="home-card balance-glow overflow-hidden">
          <div className="relative flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-[var(--radius-md)] bg-[var(--raise-2)] text-[var(--accent-ink)]">
              <UserRound className="size-5" />
            </span>
            <div>
              <h2>{me.data.nickname || "PigClaude 用户"}</h2>
              <p className="muted">{maskEmail(me.data.email)}</p>
            </div>
          </div>
          <div className="relative">
            <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
              账户余额
            </p>
            <p className="mt-3 font-mono text-[40px] leading-[1.1] font-medium tracking-[-1px] tabular-nums">
              {formatFen(me.data.balance)}
            </p>
          </div>
          <dl className="data-list relative">
            <div>
              <dt>用户 ID</dt>
              <dd>{maskUserId(me.data.id)}</dd>
            </div>
            <div>
              <dt>产品</dt>
              <dd>{me.data.productCode}</dd>
            </div>
          </dl>
        </section>
        <section className="home-card">
          <span className="grid size-11 place-items-center rounded-[var(--radius-md)] bg-[var(--raise-2)] text-[var(--accent-ink)]">
            <ShieldCheck className="size-5" />
          </span>
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
      <section className="home-card">
        <div className="flex items-start gap-3">
          <Laptop className="mt-0.5 size-5 shrink-0 text-[var(--accent-ink)]" />
          <div>
            <h2>连接你的桌面客户端</h2>
            <p className="muted mt-2">
              从 PigClaude
              桌面客户端发起授权，打开授权链接后核对设备信息并确认。已有绑定的设备需要明确确认后才会替换。
            </p>
          </div>
        </div>
      </section>
    </main>
  )
}
