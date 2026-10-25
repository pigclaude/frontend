// 负责登录与安全页：邮箱与密码、第三方账号，以及供应商核验回来后的续接和提示。
"use client"

import { Suspense, useEffect, useRef, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import type { SensitiveOperation } from "@pigclaude/api/home/identity"
import { homeApi } from "@/lib/api"
import { takePending } from "@/lib/pending-sensitive-operation"
import { QueryError, QueryLoading } from "@/components/query-state"
import { AccountPageHeader } from "@/components/account/account-page-header"
import { EmailPasswordGroup } from "@/components/account/email-password-group"
import {
  LinkedAccountsGroup,
  linkedIdentitiesKey,
} from "@/components/account/linked-accounts-group"
import {
  identityManagement,
  identityManagementError,
} from "@/components/identity/identity-management"

/** 供应商回跳可能带回的错误码；不在表里的一律不显示，避免地址栏注入任意文案。 */
const KNOWN_ERRORS = [
  "IDENTITY_CONFLICT",
  "ACCOUNT_BANNED",
  "RECENT_AUTHENTICATION_REQUIRED",
  "IDENTITY_UNAVAILABLE",
  "FEDERATION_UNAVAILABLE",
  "FEDERATION_DISABLED",
  "FEDERATION_RATE_LIMITED",
  "FEDERATION_REJECTED",
]

const header = (
  <AccountPageHeader title="登录与安全" subtitle="你用来登录的邮箱、密码和第三方账号。" />
)

/** Suspense 包住读取 searchParams 的子树，满足 Next 生产预渲染要求。 */
export default function AccountSecurityPage() {
  return (
    <Suspense fallback={header}>
      <SecurityRoute />
    </Suspense>
  )
}

/** 回跳参数只读一次：读完后从地址栏去掉，刷新页面不会重复续接或重复提示。 */
function useProviderReturn() {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const [state] = useState(() => ({
    result: params.get("identityResult"),
    error: params.get("identityError"),
  }))
  const [resume, setResume] = useState<SensitiveOperation | null>(null)
  const handled = useRef(false)
  useEffect(() => {
    if (handled.current) return
    handled.current = true
    if (state.result === "verified") setResume(takePending())
    if (state.result || state.error) router.replace(pathname)
  }, [pathname, router, state])
  return { ...state, resume }
}

function SecurityRoute() {
  const returned = useProviderReturn()
  const me = useQuery({ queryKey: ["me"], queryFn: homeApi.user.me })
  const identities = useQuery({
    queryKey: linkedIdentitiesKey,
    queryFn: identityManagement.list,
    staleTime: 0,
  })
  const mail = useQuery({ queryKey: ["mail-status"], queryFn: homeApi.auth.mailStatus })
  if (me.isPending || identities.isPending)
    return (
      <>
        {header}
        <QueryLoading label="正在读取登录方式…" />
      </>
    )
  if (me.isError || identities.isError) {
    const failed = me.isError ? me : identities
    return (
      <>
        {header}
        <QueryError error={failed.error} onRetry={() => void failed.refetch()} />
      </>
    )
  }
  const resume = returned.resume
  const feedback =
    returned.error && KNOWN_ERRORS.includes(returned.error)
      ? identityManagementError(returned.error)
      : null
  return (
    <>
      {header}
      {feedback && (
        <p role="alert" className="query-error">
          {feedback}
        </p>
      )}
      {returned.result === "verified" && !resume && (
        <p role="status" className="account-notice">
          已完成核验，请重新选择要进行的操作。操作结果以服务器检查为准。
        </p>
      )}
      {returned.result === "linked" && (
        <p role="status" className="account-notice">
          已完成绑定，以下列表是服务器上的最新状态。
        </p>
      )}
      <EmailPasswordGroup
        key={resume?.operation === "change_email" ? "resume-email" : "email"}
        me={me.data}
        identities={identities.data}
        mailAvailable={mail.isError ? true : mail.data?.available}
        resumeEmailStep={resume?.operation === "change_email" ? "email" : undefined}
      />
      <LinkedAccountsGroup
        key={resume && resume.operation !== "change_email" ? "resume-link" : "link"}
        identities={identities.data}
        hasPassword={me.data.hasPassword}
        resumeAction={
          resume && (resume.operation === "link" || resume.operation === "unlink")
            ? resume
            : undefined
        }
      />
    </>
  )
}
