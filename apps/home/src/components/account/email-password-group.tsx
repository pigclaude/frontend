// 负责「邮箱与密码」分组：邮箱行和密码行，以及它们各自打开的修改弹窗。
"use client"

import { useState } from "react"
import { KeyRound, Mail } from "lucide-react"
import type { MeResponse } from "@pigclaude/api/home/types"
import type { LinkedIdentity } from "@pigclaude/api/home/identity"
import { Button } from "@pigclaude/web-ui/components/button"
import { SetGroup, SetRow, SetTag } from "@/components/account/set-list"
import { ChangeEmailDialog, type ChangeEmailStep } from "@/components/account/change-email-dialog"
import { ChangePasswordDialog } from "@/components/account/change-password-dialog"

function changedLabel(value: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return `上次修改：${date.getMonth() + 1} 月 ${date.getDate()} 日`
}

function MailUnavailable() {
  return <span className="set-muted-text">邮件服务暂未开放</span>
}

/**
 * `mailAvailable` 为 false 时两行的按钮都换成灰字；还在读取时按钮先禁用。
 * `resumeEmailStep` 不为空时一进来就打开修改邮箱弹窗，用于供应商核验回来后续接。
 */
export function EmailPasswordGroup({
  me,
  identities,
  mailAvailable,
  resumeEmailStep,
}: {
  me: MeResponse
  identities: LinkedIdentity[]
  mailAvailable: boolean | undefined
  resumeEmailStep?: ChangeEmailStep
}) {
  const [dialog, setDialog] = useState<
    { kind: "email"; step: ChangeEmailStep } | { kind: "password" } | null
  >(resumeEmailStep ? { kind: "email", step: resumeEmailStep } : null)
  const passwordDescription = me.hasPassword
    ? changedLabel(me.passwordChangedAt)
    : "还没有设置密码，设置后可以用邮箱和密码登录"
  return (
    <>
      <SetGroup title="邮箱与密码">
        <SetRow
          icon={<Mail />}
          title="邮箱"
          badge={me.emailVerified ? <SetTag tone="success">已验证</SetTag> : undefined}
          description={me.email}
          trailing={
            mailAvailable === false ? (
              <MailUnavailable />
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label="修改邮箱"
                disabled={mailAvailable === undefined}
                onClick={() => setDialog({ kind: "email", step: "verify" })}
              >
                修改
              </Button>
            )
          }
        />
        <SetRow
          icon={<KeyRound />}
          title="密码"
          description={passwordDescription ?? undefined}
          trailing={
            mailAvailable === false ? (
              <MailUnavailable />
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={mailAvailable === undefined}
                onClick={() => setDialog({ kind: "password" })}
              >
                {me.hasPassword ? "修改密码" : "设置密码"}
              </Button>
            )
          }
        />
      </SetGroup>
      {dialog?.kind === "email" && (
        <ChangeEmailDialog
          me={me}
          identities={identities}
          initialStep={dialog.step}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "password" && (
        <ChangePasswordDialog me={me} onClose={() => setDialog(null)} />
      )}
    </>
  )
}
