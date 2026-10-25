// 负责近期身份核验弹窗外壳；表单内容见 recent-auth-form，所有结果由父级当前 owner 处理。
"use client"
import type { LinkedIdentity, SensitiveOperation } from "@pigclaude/api/home/identity"
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@pigclaude/web-ui/components/dialog"
import { RecentAuthForm } from "./recent-auth-form"

function description(action: SensitiveOperation): string {
  if (action.operation === "revoke_device")
    return "移除这台电脑前需要确认是你本人。本次核验只用于移除这台电脑，五分钟内有效且只能使用一次。"
  if (action.operation === "revoke_all_devices")
    return "移除全部电脑前需要确认是你本人。本次核验只用于这次移除，五分钟内有效且只能使用一次。"
  if (action.operation === "change_email")
    return "修改登录邮箱前需要确认是你本人。本次核验只用于修改邮箱，五分钟内有效且只能使用一次。"
  return "使用当前账号的密码或已绑定登录方式核验。本次核验只适用于所选操作，五分钟内有效且只能使用一次。"
}

/** 共享核验组件支持身份/设备精确目标，社交仅展示服务器已绑定列表。 */
export function RecentAuthDialog({
  action,
  identities,
  hasPassword,
  pending,
  error,
  onRun,
  onVerified,
  onClose,
}: {
  action: SensitiveOperation
  identities: LinkedIdentity[]
  hasPassword?: boolean
  pending: boolean
  error?: string | null
  onRun: (request: (isCurrent: () => boolean) => Promise<void>) => void
  onVerified: (isCurrent: () => boolean) => Promise<void>
  onClose: () => void
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose()
      }}
    >
      <DialogContent showCloseButton={!pending} className="max-h-[90dvh] overflow-y-auto">
        <DialogTitle>近期身份核验</DialogTitle>
        <DialogDescription>{description(action)}</DialogDescription>
        <RecentAuthForm
          action={action}
          identities={identities}
          hasPassword={hasPassword}
          pending={pending}
          error={error}
          onRun={onRun}
          onVerified={onVerified}
          onCancel={onClose}
        />
      </DialogContent>
    </Dialog>
  )
}
