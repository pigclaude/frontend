// 负责服务器启用的 User 社交入口与其下方「或使用邮箱」分隔线，不依赖密码验证码状态。
"use client"
import { Button } from "@pigclaude/web-ui/components/button"
import { LineIcon } from "@pigclaude/web-ui/components/line-icon"
import { Separator } from "@pigclaude/web-ui/components/separator"
import type { IdentityInteraction } from "@/lib/identity-api"

const labels = { google: "Google", github: "GitHub" } as const

/** 只显示服务器公开且属于 User realm 的供应商；一个都没有时整行和分隔线都不渲染。 */
export function ProviderButtons({
  interaction,
  disabled,
  onStart,
}: {
  interaction: IdentityInteraction
  disabled: boolean
  onStart: (provider: "google" | "github") => void
}) {
  if (interaction.realm !== "User") return null
  const providers = (["google", "github"] as const).filter((provider) =>
    interaction.providers.includes(provider),
  )
  if (providers.length === 0) return null
  return (
    <div className="flex flex-col gap-5">
      <div className={`grid gap-2 ${providers.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
        {providers.map((provider) => (
          <Button
            key={provider}
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={() => onStart(provider)}
            className="h-9 border-border bg-[var(--btn-bg)] text-[13px] text-foreground shadow-[var(--btn-shadow)] hover:bg-[var(--btn-bg-hover)] active:bg-[var(--raise-3)] dark:border-border dark:bg-[var(--btn-bg)] dark:hover:bg-[var(--btn-bg-hover)]"
          >
            <LineIcon name={provider} className="size-4" />
            {labels[provider]}
          </Button>
        ))}
      </div>
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <Separator className="flex-1" />
        <span className="shrink-0">或使用邮箱</span>
        <Separator className="flex-1" />
      </div>
    </div>
  )
}
