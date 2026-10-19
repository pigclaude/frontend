// 负责用户登录方式列表、精确目标核验与非乐观写入，回跳参数仅用于反馈。
"use client"
import { useLayoutEffect, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type { IdentityProvider, SensitiveOperation } from "@pigclaude/api/home/identity"
import { homeSessionGeneration } from "@/lib/session-generation"
import { Button } from "@pigclaude/web-ui/components/button"
import {
  identityManagement,
  identityManagementError,
  identityManagementNavigation,
  identityProviderNames,
} from "./identity-management"
import { RecentAuthDialog } from "./recent-auth-dialog"
const key = ["linked-identities"]
const knownErrors = [
  "IDENTITY_CONFLICT",
  "ACCOUNT_BANNED",
  "RECENT_AUTHENTICATION_REQUIRED",
  "IDENTITY_UNAVAILABLE",
  "FEDERATION_UNAVAILABLE",
  "FEDERATION_DISABLED",
  "FEDERATION_RATE_LIMITED",
  "FEDERATION_REJECTED",
]
/** 只读取真实受保护列表，不把供应商回跳当作绑定或授权成功。 */
export function LinkedIdentities() {
  const params = useSearchParams()
  return (
    <LinkedIdentitySession
      key={params.toString()}
      queryError={params.get("identityError")}
      returned={params.get("identityResult")}
    />
  )
}
function LinkedIdentitySession({
  queryError,
  returned,
}: {
  queryError: string | null
  returned: string | null
}) {
  const client = useQueryClient()
  const identities = useQuery({ queryKey: key, queryFn: identityManagement.list, staleTime: 0 })
  const [action, setAction] = useState<SensitiveOperation | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const generation = useRef(0)
  const owner = useRef<symbol | null>(null)
  const mounted = useRef(false)
  useLayoutEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      generation.current++
      owner.current = null
    }
  }, [])
  function run(request: (isCurrent: () => boolean) => Promise<void>) {
    if (owner.current || !mounted.current) return
    const current = generation.current
    const sessionGeneration = homeSessionGeneration.current()
    const token = Symbol()
    owner.current = token
    const isCurrent = () =>
      mounted.current &&
      current === generation.current &&
      sessionGeneration === homeSessionGeneration.current() &&
      token === owner.current
    setPending(true)
    setError(null)
    void request(isCurrent)
      .catch((reason: unknown) => {
        if (isCurrent()) setError(identityManagementError(reason))
      })
      .finally(() => {
        if (isCurrent()) {
          owner.current = null
          setPending(false)
        }
      })
  }
  async function execute(isCurrent: () => boolean) {
    if (!action || (action.operation !== "link" && action.operation !== "unlink")) return
    if (action.operation === "link") {
      const result = await identityManagement.link(action.provider, isCurrent)
      if (isCurrent()) identityManagementNavigation.assign(result.redirect)
    } else {
      await identityManagement.unlink(action.provider, isCurrent)
      if (!isCurrent()) return
      await client.invalidateQueries({ queryKey: key })
      if (isCurrent()) setAction(null)
    }
  }
  function choose(operation: "link" | "unlink", provider: IdentityProvider) {
    setError(null)
    generation.current++
    setAction({ operation, provider })
  }
  const feedback =
    error ??
    (queryError && knownErrors.includes(queryError) ? identityManagementError(queryError) : null)
  return (
    <div className="flex flex-col gap-4">
      <h1 className="page-title">登录方式</h1>
      {feedback && !action && (
        <p role="alert" className="query-error">
          {feedback}
        </p>
      )}
      {(returned === "linked" || returned === "verified") && (
        <p role="status">
          已返回登录方式管理，请核对当前列表并继续所选操作。操作状态以服务器检查结果为准。
        </p>
      )}
      {identities.isPending && <p role="status">正在读取登录方式…</p>}
      {identities.isError && (
        <div role="alert">
          <p>{identityManagementError(identities.error)}</p>
          <Button onClick={() => void identities.refetch()}>刷新列表</Button>
        </div>
      )}
      {identities.data && (
        <>
          <section className="home-card">
            {identities.data.length === 0 && (
              <p>尚未绑定外部登录方式，可使用现有密码核验后绑定。</p>
            )}
            {(["google", "github"] as const).map((provider) => {
              const linked = identities.data.find((item) => item.provider === provider)
              return (
                <div key={provider} className="flex flex-wrap items-center gap-3">
                  <span>{linked?.display ?? identityProviderNames[provider]}</span>
                  <Button
                    variant="outline"
                    disabled={pending || Boolean(linked && !linked.canUnlink)}
                    onClick={() => choose(linked ? "unlink" : "link", provider)}
                  >
                    {linked ? "解绑" : "绑定"} {identityProviderNames[provider]}
                  </Button>
                  {linked && !linked.canUnlink && (
                    <p>不能移除最后一个可用凭据，请先绑定另一种登录方式。</p>
                  )}
                </div>
              )
            })}
          </section>
          {action && (
            <RecentAuthDialog
              key={JSON.stringify(action)}
              action={action}
              identities={identities.data}
              pending={pending}
              error={feedback}
              onRun={run}
              onVerified={execute}
              onClose={() => {
                generation.current++
                setAction(null)
                setError(null)
              }}
            />
          )}
        </>
      )}
    </div>
  )
}
