// 负责展示已核验的本人设备关系，撤销关系需要明确重新授权确认。
"use client"
import { useState } from "react"
import { Button } from "@pigclaude/web-ui/components/button"
import type { IdentityInteraction } from "@/lib/identity-api"
/** 原生审批只使用服务器设备视图，不依赖 Home Cookie 或客户端设备推断。 */
export function DeviceApproval({
  interaction,
  disabled,
  onApprove,
  onDeny,
}: {
  interaction: IdentityInteraction
  disabled: boolean
  onApprove: (reauthorize: boolean) => void
  onDeny: () => void
}) {
  const [confirmed, setConfirmed] = useState(false)
  const device = interaction.device
  if (interaction.realm !== "User" || !device)
    return <p role="alert">设备信息不可用，请从客户端重新发起授权</p>
  const revoked = device.status === "revoked"
  return (
    <div className="flex flex-col gap-4">
      <p>{device.name}</p>
      <p className="text-sm text-muted-foreground">
        {device.platform} ·{" "}
        {device.status === "new" ? "新增设备" : revoked ? "已撤销的设备" : "已授权设备"}
      </p>
      <p className="text-sm text-muted-foreground">本次授权不会退出其他已登录设备。</p>
      {revoked && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={confirmed}
            disabled={disabled}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          我确认重新授权此设备
        </label>
      )}
      <Button
        disabled={disabled || (revoked && !confirmed)}
        onClick={() => onApprove(revoked && confirmed)}
      >
        {revoked ? "重新授权设备" : "授权设备"}
      </Button>
      <Button variant="outline" disabled={disabled} onClick={onDeny}>
        拒绝
      </Button>
    </div>
  )
}
