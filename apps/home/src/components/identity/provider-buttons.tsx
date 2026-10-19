// 负责服务器启用的 User 社交入口，不依赖密码验证码状态。
"use client"
import { Button } from "@pigclaude/web-ui/components/button"
import type { IdentityInteraction } from "@/lib/identity-api"
/** 只显示服务器公开且属于 User realm 的供应商。 */
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
  return (
    <div className="flex flex-col gap-3">
      {(["google", "github"] as const)
        .filter((provider) => interaction.providers.includes(provider))
        .map((provider) => (
          <Button
            key={provider}
            variant="outline"
            disabled={disabled}
            onClick={() => onStart(provider)}
          >
            使用 {provider === "google" ? "Google" : "GitHub"} 登录
          </Button>
        ))}
    </div>
  )
}
