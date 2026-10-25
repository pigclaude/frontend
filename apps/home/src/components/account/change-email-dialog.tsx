// 负责修改邮箱弹窗的三步：近期核验 → 新邮箱发码 → 填码确认；占用邮箱与错码表现一致。
"use client"

import { useState, type FormEvent } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { ApiError } from "@pigclaude/api/client"
import type { MeResponse } from "@pigclaude/api/home/types"
import type { LinkedIdentity } from "@pigclaude/api/home/identity"
import { Button } from "@pigclaude/web-ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@pigclaude/web-ui/components/dialog"
import { Input } from "@pigclaude/web-ui/components/input"
import { TurnstileCaptcha } from "@pigclaude/web-ui/components/turnstile-captcha"
import { useTurnstileCaptcha } from "@pigclaude/web-ui/hooks/use-turnstile-captcha"
import { homeApi } from "@/lib/api"
import { accountCredentialError, retryAfterSeconds } from "@/lib/account-credential-errors"
import { useOwnedAction } from "@/lib/use-owned-action"
import { useResendCountdown } from "@/lib/use-resend-countdown"
import { identityManagementError } from "@/components/identity/identity-management"
import { RecentAuthForm } from "@/components/identity/recent-auth-form"

/** 弹窗所处的步骤；从供应商核验回来时直接从 `email` 开始。 */
export type ChangeEmailStep = "verify" | "email" | "code"

const STEP_TEXT: Record<ChangeEmailStep, string> = {
  verify: "第 1 步，共 3 步：确认是你本人。",
  email: "第 2 步，共 3 步：填写新邮箱，我们会往新邮箱发送验证码。",
  code: "第 3 步，共 3 步：填写新邮箱收到的 6 位验证码。",
}

/** 403 表示近期核验已失效，需要回到第 1 步重新核验。 */
function proofExpired(cause: unknown): boolean {
  return cause instanceof ApiError && cause.status === 403
}

/** 修改登录邮箱；成功后更新顶栏和资料缓存，并给出「邮箱已修改」提示。 */
export function ChangeEmailDialog({
  me,
  identities,
  initialStep = "verify",
  onClose,
}: {
  me: MeResponse
  identities: LinkedIdentity[]
  initialStep?: ChangeEmailStep
  onClose: () => void
}) {
  const client = useQueryClient()
  const { pending, run } = useOwnedAction()
  const countdown = useResendCountdown()
  const captcha = useTurnstileCaptcha({ loadConfig: homeApi.auth.captcha, action: "email_code" })
  const [step, setStep] = useState<ChangeEmailStep>(initialStep)
  const [email, setEmail] = useState("")
  const [sentTo, setSentTo] = useState("")
  const [code, setCode] = useState("")
  const [error, setError] = useState<string | null>(null)

  function backToVerify(message: string) {
    setError(message)
    setStep("verify")
  }

  function sendCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const target = email.trim().toLowerCase()
    if (!target) return
    if (target === me.email.toLowerCase()) {
      setError("新邮箱不能和当前邮箱相同")
      return
    }
    if (pending || countdown.seconds > 0 || !captcha.ready) return
    setError(null)
    run(
      (isCurrent) =>
        captcha.run((captchaToken) =>
          homeApi.account.sendCode(
            { purpose: "change_email", email: target, ...(captchaToken ? { captchaToken } : {}) },
            isCurrent,
          ),
        ),
      {
        onSuccess: (result) => {
          countdown.start(result.resendAfterSeconds > 0 ? result.resendAfterSeconds : 60)
          setSentTo(target)
          setCode("")
          setStep("code")
        },
        onError: (cause) => {
          if (proofExpired(cause)) return backToVerify("身份核验已过期，请重新核验")
          const wait = retryAfterSeconds(cause)
          if (wait) countdown.start(wait)
          setError(accountCredentialError(cause, "send_email_code"))
        },
      },
    )
  }

  function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    if (!/^\d{6}$/.test(code.trim())) {
      setError("请输入 6 位数字验证码")
      return
    }
    setError(null)
    run(
      (isCurrent) =>
        homeApi.account.changeEmail({ email: sentTo, emailCode: code.trim() }, isCurrent),
      {
        onSuccess: (result) => {
          client.setQueryData<MeResponse>(["me"], (current) =>
            current ? { ...current, email: result.email, emailVerified: true } : current,
          )
          void client.invalidateQueries({ queryKey: ["me"] })
          toast.success("邮箱已修改")
          onClose()
        },
        onError: (cause) => {
          if (proofExpired(cause)) return backToVerify("身份核验已过期，请重新核验")
          setError(accountCredentialError(cause, "change_email"))
        },
      },
    )
  }

  function changeAddress() {
    setError(null)
    setCode("")
    countdown.reset()
    setStep("email")
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose()
      }}
    >
      <DialogContent showCloseButton={!pending} className="max-h-[90dvh] overflow-y-auto">
        <DialogTitle>修改邮箱</DialogTitle>
        <DialogDescription>{STEP_TEXT[step]}</DialogDescription>
        {step === "verify" && (
          <RecentAuthForm
            action={{ operation: "change_email" }}
            identities={identities}
            hasPassword={me.hasPassword}
            pending={pending}
            error={error}
            onRun={(request) =>
              run(request, { onError: (cause) => setError(identityManagementError(cause)) })
            }
            onVerified={async () => {
              setError(null)
              setStep("email")
            }}
            onCancel={onClose}
          />
        )}
        {step === "email" && (
          <form onSubmit={sendCode} className="flex flex-col gap-3">
            {error && (
              <p role="alert" className="query-error">
                {error}
              </p>
            )}
            <p className="text-[13px] text-muted-foreground">当前邮箱：{me.email}</p>
            <label htmlFor="new-email" className="text-[13px] font-medium">
              新邮箱
            </label>
            <Input
              id="new-email"
              type="email"
              autoComplete="email"
              value={email}
              disabled={pending}
              onChange={(event) => {
                setEmail(event.target.value)
                countdown.reset()
              }}
            />
            <TurnstileCaptcha {...captcha.field} />
            <Button
              type="submit"
              disabled={pending || !captcha.ready || !email.trim() || countdown.seconds > 0}
            >
              {countdown.seconds > 0 ? `${countdown.seconds} 秒后可重发` : "发送验证码"}
            </Button>
            <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>
              取消
            </Button>
          </form>
        )}
        {step === "code" && (
          <form onSubmit={confirm} className="flex flex-col gap-3">
            {error && (
              <p role="alert" className="query-error">
                {error}
              </p>
            )}
            <p className="text-[13px] text-muted-foreground">验证码已发送到 {sentTo}</p>
            <label htmlFor="email-change-code" className="text-[13px] font-medium">
              验证码
            </label>
            <Input
              id="email-change-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="6 位数字"
              value={code}
              disabled={pending}
              onChange={(event) => setCode(event.target.value)}
            />
            <p className="text-[12.5px] text-muted-foreground">
              没收到？确认邮箱地址是否正确，或换一个邮箱。
            </p>
            <Button type="submit" disabled={pending || !code.trim()}>
              {pending ? "正在修改…" : "确认修改"}
            </Button>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" disabled={pending} onClick={changeAddress}>
                换一个邮箱
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={pending || countdown.seconds > 0}
                onClick={() => {
                  setError(null)
                  setStep("email")
                }}
              >
                {countdown.seconds > 0 ? `${countdown.seconds} 秒后可重发` : "重新发送"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
