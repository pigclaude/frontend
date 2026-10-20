// 负责桌面授权页正文：谁在授权、授权哪台设备、授权后会怎样，撤销过的设备需要明确重新授权确认。
"use client"
import { useState } from "react"
import { Card } from "@pigclaude/web-ui/components/card"
import { Checkbox } from "@pigclaude/web-ui/components/checkbox"
import { Label } from "@pigclaude/web-ui/components/label"
import { LineIcon } from "@pigclaude/web-ui/components/line-icon"
import { Separator } from "@pigclaude/web-ui/components/separator"
import { AccountCard, authorizationCardClass } from "./account-card"
import { AuthorizationActions, usePressedAction } from "./authorization-actions"
import type { IdentityInteraction } from "@/lib/identity-api"

const statusLabels = { new: "新设备", active: "已授权设备", revoked: "已撤销的设备" } as const
const platformLabels: Record<string, string> = {
  macos: "macOS",
  windows: "Windows",
  linux: "Linux",
}
const notes = ["授权后桌面端可使用你的会员", "不会让其他设备退出登录", "随时可在「设备管理」里撤销"]

/**
 * 只使用服务器设备视图，不依赖 Home Cookie 或客户端设备推断。
 * 已撤销设备必须勾选确认才可提交，`onApprove(reauthorize)` 仅在勾选后传 true；
 * 「取消」走现有拒绝，「切换账号」交给父级的唯一 mutation owner。
 */
export function DeviceApproval({
  interaction,
  disabled,
  onApprove,
  onDeny,
  onSwitchAccount,
}: {
  interaction: IdentityInteraction
  disabled: boolean
  onApprove: (reauthorize: boolean) => void
  onDeny: () => void
  onSwitchAccount: () => void
}) {
  const [confirmed, setConfirmed] = useState(false)
  const [pressed, setPressed] = usePressedAction<"approve" | "deny" | "switch">(disabled)
  const device = interaction.device
  if (interaction.realm !== "User" || !device)
    return <p role="alert">设备信息不可用，请从客户端重新发起授权</p>
  const revoked = device.status === "revoked"
  const platform = platformLabels[device.platform.toLowerCase()] ?? device.platform
  return (
    <div className="flex flex-col gap-3">
      <AccountCard
        account={interaction.account}
        disabled={disabled}
        switching={pressed === "switch"}
        onSwitchAccount={() => {
          setPressed("switch")
          onSwitchAccount()
        }}
      />
      <Card className={`${authorizationCardClass} px-4 py-3.5`}>
        <div className="flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-[var(--raise-1)] text-[var(--fg-2)]">
            <LineIcon name="monitor" className="size-[18px]" />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-sm font-medium text-foreground">{device.name}</span>
            <span
              className={`text-xs ${revoked ? "text-[var(--warn-ink)]" : "text-muted-foreground"}`}
            >
              {platform} · {statusLabels[device.status]}
            </span>
          </div>
        </div>
        <Separator className="my-3" />
        <ul className="flex flex-col gap-1.5 text-[13px] leading-5 text-muted-foreground">
          {notes.map((note) => (
            <li key={note} className="flex items-start gap-2.5">
              <span
                aria-hidden="true"
                className="mt-2 size-1 shrink-0 rounded-full bg-[color-mix(in_oklab,var(--muted),transparent_30%)]"
              />
              <span>{note}</span>
            </li>
          ))}
        </ul>
        {revoked && (
          <div className="mt-3 flex items-center gap-2.5 rounded-lg border border-border bg-[var(--raise-1)] px-3 py-2.5">
            <Checkbox
              id="reauthorize-device"
              checked={confirmed}
              disabled={disabled}
              onCheckedChange={(value) => setConfirmed(value === true)}
            />
            <Label
              htmlFor="reauthorize-device"
              className="text-[13px] font-normal text-[var(--fg-2)]"
            >
              我确认重新授权此设备
            </Label>
          </div>
        )}
      </Card>
      <div className="mt-3">
        <AuthorizationActions
          primaryLabel={revoked ? "重新授权设备" : "授权并打开桌面端"}
          primaryBlocked={revoked && !confirmed}
          disabled={disabled}
          busy={pressed === "approve" ? "primary" : pressed === "deny" ? "cancel" : null}
          onPrimary={() => {
            setPressed("approve")
            onApprove(revoked && confirmed)
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
