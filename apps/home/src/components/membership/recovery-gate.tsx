// 只在当前网站会话与桌面办理目标对齐后挂载会员结算，错账号保持登录并等待主动切换。
"use client"
import { useEffect, useRef, useState, type ReactNode } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ApiError, StaleSessionResponse } from "@pigclaude/api/client"
import { beginWebOidcLogin } from "@pigclaude/api/web-oidc"
import { Button } from "@pigclaude/web-ui/components/button"
import { useHomeSessionActions } from "@/components/home-session-context"
import { QueryError, QueryLoading } from "@/components/query-state"
import { homeApi } from "@/lib/api"
import { homeSessionGeneration } from "@/lib/session-generation"

/** 严格读取唯一的短期办理目标；缺失、重复或畸形值均不可退回普通购买。 */
export function recoveryTargetFrom(values: string[]): string | null {
  return values.length === 1 &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(values[0])
    ? values[0]
    : null
}

/** 公开入口只提供显式登录动作，不凭桌面目标自动登录网站。 */
export function RecoveryLogin({ target }: { target: string }) {
  return (
    <div className="query-state space-y-4">
      <p>请登录桌面应用中显示的账号，再继续办理会员。</p>
      <Button
        onClick={() =>
          beginWebOidcLogin({
            site: "home",
            mode: "login",
            returnTo: `/membership/recovery?target=${target}`,
          })
        }
      >
        登录并继续
      </Button>
    </div>
  )
}

/** 对齐结果属于当前网站账号和会话；办理目标不提供登录或订单归属权限。 */
export function MembershipRecoveryGate({
  target,
  ownerId,
  accountLabel,
  session,
  children,
}: {
  target: string | null
  ownerId: string
  accountLabel: string
  session: number
  children: ReactNode
}) {
  const client = useQueryClient()
  const actions = useHomeSessionActions()
  const [switching, setSwitching] = useState(false)
  const [switchError, setSwitchError] = useState(false)
  const verified = useRef(false)
  const busy = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const isCurrent = () =>
    mounted.current &&
    session === homeSessionGeneration.current() &&
    client.getQueryData<{ id: string }>(["me"])?.id === ownerId
  const resolution = useQuery({
    queryKey: ["membership-recovery", target, ownerId, session],
    enabled: target !== null,
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async ({ signal }) => {
      if (!target || !isCurrent()) throw new StaleSessionResponse()
      const result = await homeApi.membership.recoveryTarget(target)
      if (signal.aborted || !isCurrent()) throw new StaleSessionResponse()
      if (!result || !["matched", "mismatch", "unavailable"].includes(result.state))
        throw new Error("暂时无法核对办理账号，请重试。")
      if (result.state === "matched" && result.currentUserId !== ownerId)
        throw new Error("网站账号已变化，请重新检查。")
      return result
    },
  })
  async function switchAccount() {
    if (busy.current || !isCurrent() || !target) return
    busy.current = true
    setSwitching(true)
    setSwitchError(false)
    try {
      await homeApi.auth.logout(isCurrent, ownerId)
      if (isCurrent())
        await actions.completeLogout({
          switchAccountReturnTo: `/membership/recovery?target=${target}`,
        })
    } catch {
      if (isCurrent()) setSwitchError(true)
    } finally {
      busy.current = false
      if (mounted.current) setSwitching(false)
    }
  }
  if (!target)
    return (
      <p role="alert" className="query-state">
        办理入口无效或已过期，请回到桌面应用重新打开。
      </p>
    )
  if (resolution.isSuccess && !resolution.isFetching && resolution.data.state === "matched")
    verified.current = true
  if (resolution.isPending || (resolution.isFetching && !verified.current))
    return <QueryLoading label="正在核对办理账号…" />
  if (resolution.isError) {
    if (resolution.error instanceof ApiError && resolution.error.status === 401)
      return <RecoveryLogin target={target} />
    return (
      <QueryError
        error={resolution.error}
        onRetry={() =>
          void client.invalidateQueries({ queryKey: ["me"] }).then(() => resolution.refetch())
        }
      />
    )
  }
  if (resolution.data.state === "unavailable")
    return (
      <p role="alert" className="query-state">
        办理入口无效或已过期，请回到桌面应用重新打开。
      </p>
    )
  if (resolution.data.state === "mismatch")
    return (
      <section className="query-state space-y-4" aria-label="核对办理账号">
        <h1 className="page-title">请确认网站账号</h1>
        <p>
          当前网站账号：<span>{accountLabel}</span>
        </p>
        <p>请使用桌面应用中显示的账号办理会员。当前网站账号会保留登录，切换后才会继续。</p>
        <Button disabled={switching} onClick={() => void switchAccount()}>
          {switching ? "正在切换…" : "切换网站账号"}
        </Button>
        {switchError && <p role="alert">切换未完成，请重新检查网站登录状态后重试。</p>}
      </section>
    )
  return (
    <div aria-busy={resolution.isFetching} inert={resolution.isFetching}>
      {children}
    </div>
  )
}
