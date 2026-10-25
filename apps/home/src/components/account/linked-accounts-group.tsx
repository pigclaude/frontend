// 负责「第三方账号」分组：每个供应商一行，绑定和解绑都先近期核验，最后一个登录方式不能解绑。
"use client"

import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import type {
  IdentityProvider,
  LinkedIdentity,
  SensitiveOperation,
} from "@pigclaude/api/home/identity"
import { Button } from "@pigclaude/web-ui/components/button"
import { LineIcon } from "@pigclaude/web-ui/components/line-icon"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@pigclaude/web-ui/components/tooltip"
import { useOwnedAction } from "@/lib/use-owned-action"
import { SetGroup, SetRow, SetTag } from "@/components/account/set-list"
import {
  identityManagement,
  identityManagementError,
  identityManagementNavigation,
  identityProviderNames,
} from "@/components/identity/identity-management"
import { RecentAuthDialog } from "@/components/identity/recent-auth-dialog"

/** 页面和本组件共用的已绑定列表查询键。 */
export const linkedIdentitiesKey = ["linked-identities"]

const PROVIDERS: readonly IdentityProvider[] = ["google", "github"]

function linkedAtLabel(value: string): string | null {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日绑定`
}

function UnlinkBlocked({ name }: { name: string }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={`解绑 ${name}`}
            aria-disabled="true"
            className="cursor-not-allowed opacity-50"
            onClick={(event) => event.preventDefault()}
          >
            解绑
          </Button>
        </TooltipTrigger>
        <TooltipContent>先设置密码或绑定另一个账号</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/**
 * 只渲染服务器返回的真实列表，不把供应商回跳当作成功。`resumeAction` 是从供应商核验
 * 回来后需要续接的绑定或解绑，会直接打开核验弹窗等用户点「使用已有核验继续」。
 */
export function LinkedAccountsGroup({
  identities,
  hasPassword,
  resumeAction,
}: {
  identities: LinkedIdentity[]
  hasPassword: boolean
  resumeAction?: SensitiveOperation
}) {
  const client = useQueryClient()
  const { pending, run, cancel } = useOwnedAction()
  const [action, setAction] = useState<SensitiveOperation | null>(resumeAction ?? null)
  const [error, setError] = useState<string | null>(null)

  function onRun(request: (isCurrent: () => boolean) => Promise<void>) {
    setError(null)
    run(request, { onError: (cause) => setError(identityManagementError(cause)) })
  }
  async function execute(isCurrent: () => boolean) {
    if (!action || (action.operation !== "link" && action.operation !== "unlink")) return
    if (action.operation === "link") {
      const result = await identityManagement.link(action.provider, isCurrent)
      if (isCurrent()) identityManagementNavigation.assign(result.redirect)
      return
    }
    await identityManagement.unlink(action.provider, isCurrent)
    if (!isCurrent()) return
    await client.invalidateQueries({ queryKey: linkedIdentitiesKey })
    if (isCurrent()) setAction(null)
  }
  function choose(operation: "link" | "unlink", provider: IdentityProvider) {
    cancel()
    setError(null)
    setAction({ operation, provider })
  }

  return (
    <>
      <SetGroup title="第三方账号">
        {PROVIDERS.map((provider) => {
          const name = identityProviderNames[provider]
          const linked = identities.find((item) => item.provider === provider)
          const since = linked ? linkedAtLabel(linked.linkedAt) : null
          return (
            <SetRow
              key={provider}
              icon={<LineIcon name={provider} />}
              title={name}
              badge={
                linked ? (
                  <SetTag tone="success">已绑定</SetTag>
                ) : (
                  <SetTag tone="muted">未绑定</SetTag>
                )
              }
              description={
                linked
                  ? [linked.display, since].filter(Boolean).join(" · ")
                  : `绑定后可以用 ${name} 一键登录`
              }
              trailing={
                linked && !linked.canUnlink ? (
                  <UnlinkBlocked name={name} />
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant={linked ? "outline" : "default"}
                    aria-label={`${linked ? "解绑" : "绑定"} ${name}`}
                    disabled={pending}
                    onClick={() => choose(linked ? "unlink" : "link", provider)}
                  >
                    {linked ? "解绑" : "绑定"}
                  </Button>
                )
              }
            />
          )
        })}
      </SetGroup>
      {action && (
        <RecentAuthDialog
          key={JSON.stringify(action)}
          action={action}
          identities={identities}
          hasPassword={hasPassword}
          pending={pending}
          error={error}
          onRun={onRun}
          onVerified={execute}
          onClose={() => {
            cancel()
            setAction(null)
            setError(null)
          }}
        />
      )}
    </>
  )
}
