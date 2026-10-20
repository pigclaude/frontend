// 负责授权类页面里「当前是哪个账号」的卡片：首字母头像、显示名、邮箱和可选的切换入口。
"use client"
import { Button } from "@pigclaude/web-ui/components/button"
import { Card } from "@pigclaude/web-ui/components/card"
import { PendingSpinner } from "./authorization-actions"
import { accountDisplayName, type IdentityInteraction } from "@/lib/identity-api"

/** 授权页卡片的统一外观，深浅主题都由令牌决定。 */
export const authorizationCardClass =
  "gap-0 rounded-xl border-border bg-[var(--card-bg)] py-0 shadow-[var(--card-shadow)]"

/**
 * 有账号时显示首字母头像、邮箱前缀和完整邮箱；没有账号视图时只保留切换入口，不臆造身份。
 * 不传 `onSwitchAccount` 时不渲染「切换账号」。
 */
export function AccountCard({
  account,
  disabled,
  switching = false,
  onSwitchAccount,
}: {
  account: IdentityInteraction["account"]
  disabled: boolean
  switching?: boolean
  onSwitchAccount?: () => void
}) {
  if (!account && !onSwitchAccount) return null
  const name = account ? accountDisplayName(account.email) : ""
  return (
    <Card className={`${authorizationCardClass} flex-row items-center gap-3 px-4 py-3`}>
      {account && (
        <>
          <span
            aria-hidden="true"
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_oklab,var(--accent),transparent_82%)] text-sm font-semibold text-[var(--accent-ink)] uppercase"
          >
            {name.slice(0, 1)}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-sm font-medium text-foreground">{name}</span>
            <span className="truncate text-xs text-muted-foreground">{account.email}</span>
          </div>
        </>
      )}
      {onSwitchAccount && (
        <Button
          type="button"
          variant="link"
          aria-busy={switching || undefined}
          disabled={disabled}
          onClick={onSwitchAccount}
          className="ml-auto h-auto shrink-0 rounded-sm p-0 text-[13px] font-medium text-[var(--accent-ink)] underline-offset-4 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
        >
          {switching && <PendingSpinner />}
          切换账号
        </Button>
      )}
    </Card>
  )
}
