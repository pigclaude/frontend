// 负责显式 consent 阶段的正文：沿用授权页卡片样式，不提供切换账号。
"use client"
import { AccountCard } from "./account-card"
import { AuthorizationActions, usePressedAction } from "./authorization-actions"
import type { IdentityInteraction } from "@/lib/identity-api"

/**
 * 只在显式 `prompt=consent` 时出现。「同意」「取消」分别回调父级；
 * 不提供「切换账号」，因为在这里切换会撤销正在等待的这次网站登录，使其无法完成。
 */
export function ConsentApproval({
  interaction,
  disabled,
  onConsent,
  onDeny,
}: {
  interaction: IdentityInteraction
  disabled: boolean
  onConsent: () => void
  onDeny: () => void
}) {
  const [pressed, setPressed] = usePressedAction<"consent" | "deny">(disabled)
  return (
    <div className="flex flex-col gap-3">
      <AccountCard account={interaction.account} disabled={disabled} />
      <div className="mt-3">
        <AuthorizationActions
          primaryLabel="同意"
          disabled={disabled}
          busy={pressed === "consent" ? "primary" : pressed === "deny" ? "cancel" : null}
          onPrimary={() => {
            setPressed("consent")
            onConsent()
          }}
          onCancel={() => {
            setPressed("deny")
            onDeny()
          }}
        />
      </div>
    </div>
  )
}
