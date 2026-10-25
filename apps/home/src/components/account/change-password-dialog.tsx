// 负责设置或修改密码弹窗：先向账号邮箱发码，再填码和新密码；成功后所有登录失效并回到登录页。
"use client"

import { useEffect, useState, type FormEvent } from "react"
import type { MeResponse } from "@pigclaude/api/home/types"
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
import { maskEmail } from "@/lib/identity-mask"
import { useOwnedAction } from "@/lib/use-owned-action"
import { useResendCountdown } from "@/lib/use-resend-countdown"
import { useHomeSessionActions } from "@/components/home-session-context"

/** 成功提示停留多久后跳转登录页，让用户看清发生了什么。 */
const SIGN_OUT_DELAY_MS = 1500

/** 本地先按服务端同样的规则检查新密码，合格时返回 null。 */
export function newPasswordError(password: string, confirmation: string): string | null {
  const length = Array.from(password).length
  if (length < 8 || length > 1024) return "新密码需要 8～1024 个字符"
  if (password !== confirmation) return "两次输入的密码不一致"
  return null
}

/** `me.hasPassword` 为 false 时是「设置密码」，否则是「修改密码」，流程相同。 */
export function ChangePasswordDialog({ me, onClose }: { me: MeResponse; onClose: () => void }) {
  const { completeLogout } = useHomeSessionActions()
  const { pending, run } = useOwnedAction()
  const countdown = useResendCountdown()
  const captcha = useTurnstileCaptcha({ loadConfig: homeApi.auth.captcha, action: "email_code" })
  const [step, setStep] = useState<"send" | "form" | "done">("send")
  const [code, setCode] = useState("")
  const [password, setPassword] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [error, setError] = useState<string | null>(null)
  const title = me.hasPassword ? "修改密码" : "设置密码"

  useEffect(() => {
    if (step !== "done") return
    const timer = window.setTimeout(() => void completeLogout(), SIGN_OUT_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [step, completeLogout])

  function sendCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending || countdown.seconds > 0 || !captcha.ready) return
    setError(null)
    run(
      (isCurrent) =>
        captcha.run((captchaToken) =>
          homeApi.account.sendCode(
            { purpose: "password", ...(captchaToken ? { captchaToken } : {}) },
            isCurrent,
          ),
        ),
      {
        onSuccess: (result) => {
          countdown.start(result.resendAfterSeconds > 0 ? result.resendAfterSeconds : 60)
          setStep("form")
        },
        onError: (cause) => {
          const wait = retryAfterSeconds(cause)
          if (wait) countdown.start(wait)
          setError(accountCredentialError(cause, "send_password_code"))
        },
      },
    )
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    if (!/^\d{6}$/.test(code.trim())) {
      setError("请输入 6 位数字验证码")
      return
    }
    const problem = newPasswordError(password, confirmation)
    if (problem) {
      setError(problem)
      return
    }
    setError(null)
    run(
      (isCurrent) =>
        homeApi.account.changePassword(
          { emailCode: code.trim(), newPassword: password },
          isCurrent,
        ),
      {
        onSuccess: () => setStep("done"),
        onError: (cause) => setError(accountCredentialError(cause, "password")),
      },
    )
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending && step !== "done") onClose()
      }}
    >
      <DialogContent
        showCloseButton={!pending && step !== "done"}
        className="max-h-[90dvh] overflow-y-auto"
      >
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          {step === "done"
            ? "所有设备和浏览器都已退出登录。"
            : `为确认是你本人，我们会向 ${maskEmail(me.email)} 发送验证码。`}
        </DialogDescription>
        {error && (
          <p role="alert" className="query-error">
            {error}
          </p>
        )}
        {step === "send" && (
          <form onSubmit={sendCode} className="flex flex-col gap-3">
            <TurnstileCaptcha {...captcha.field} />
            <Button type="submit" disabled={pending || !captcha.ready || countdown.seconds > 0}>
              {countdown.seconds > 0 ? `${countdown.seconds} 秒后可重发` : "发送验证码"}
            </Button>
            <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>
              取消
            </Button>
          </form>
        )}
        {step === "form" && (
          <form onSubmit={submit} className="flex flex-col gap-3">
            <label htmlFor="password-code" className="text-[13px] font-medium">
              验证码
            </label>
            <Input
              id="password-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="6 位数字"
              value={code}
              disabled={pending}
              onChange={(event) => setCode(event.target.value)}
            />
            <label htmlFor="new-password" className="text-[13px] font-medium">
              新密码
            </label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={password}
              disabled={pending}
              onChange={(event) => setPassword(event.target.value)}
            />
            <label htmlFor="confirm-password" className="text-[13px] font-medium">
              确认新密码
            </label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmation}
              disabled={pending}
              onChange={(event) => setConfirmation(event.target.value)}
            />
            <p className="text-[12.5px] text-muted-foreground">
              保存后所有设备和浏览器都会退出登录，包括当前这个。
            </p>
            <Button type="submit" disabled={pending || !code.trim() || !password}>
              {pending ? "正在保存…" : `确认${title}`}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={pending || countdown.seconds > 0}
              onClick={() => {
                setError(null)
                setStep("send")
              }}
            >
              {countdown.seconds > 0 ? `${countdown.seconds} 秒后可重发` : "重新发送验证码"}
            </Button>
          </form>
        )}
        {step === "done" && (
          <div className="flex flex-col gap-3">
            <p role="status" className="text-[14px] font-medium">
              {me.hasPassword ? "密码已修改" : "密码已设置"}，请用新密码登录。
            </p>
            <Button type="button" onClick={() => void completeLogout()}>
              去登录
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
