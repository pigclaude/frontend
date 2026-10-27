// 桌面会员办理的公开落点：未登录时等待主动登录，对齐后才进入现有会员页。
"use client"
import { Suspense, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { ApiError } from "@pigclaude/api/client"
import {
  MembershipRecoveryGate,
  RecoveryLogin,
  recoveryTargetFrom,
} from "@/components/membership/recovery-gate"
import { QueryError, QueryLoading } from "@/components/query-state"
import { homeApi } from "@/lib/api"
import { homeSessionGeneration } from "@/lib/session-generation"

/** 公开落点不要求既有网站会话，且不自动结束其他账号的登录。 */
export default function MembershipRecoveryPage() {
  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <Suspense fallback={<QueryLoading label="正在读取办理入口…" />}>
        <RecoveryRoute />
      </Suspense>
    </main>
  )
}
function RecoveryRoute() {
  const params = useSearchParams()
  const target = recoveryTargetFrom(params.getAll("target"))
  const me = useQuery({
    queryKey: ["me"],
    queryFn: homeApi.user.me,
    enabled: target !== null,
    staleTime: 0,
  })
  if (!target) return <p role="alert">办理入口无效或已过期，请回到桌面应用重新打开。</p>
  if (me.isPending || me.isFetching) return <QueryLoading label="正在读取网站账号…" />
  if (me.isError)
    return me.error instanceof ApiError && me.error.status === 401 ? (
      <RecoveryLogin target={target} />
    ) : (
      <QueryError error={me.error} onRetry={() => void me.refetch()} />
    )
  return (
    <MembershipRecoveryGate
      key={`${target}:${me.data.id}:${homeSessionGeneration.current()}`}
      target={target}
      ownerId={me.data.id}
      accountLabel={me.data.email || me.data.nickname || "当前账号"}
      session={homeSessionGeneration.current()}
    >
      <ContinueMembership target={target} />
    </MembershipRecoveryGate>
  )
}
function ContinueMembership({ target }: { target: string }) {
  const router = useRouter()
  useEffect(() => {
    router.replace(`/membership?recoveryTarget=${target}`)
  }, [router, target])
  return <QueryLoading label="正在进入会员办理…" />
}
