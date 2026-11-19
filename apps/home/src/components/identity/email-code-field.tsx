// 负责注册模式的验证码输入、发送按钮、60 秒倒计时和发码错误提示。
"use client"

import { useEffect, useState } from "react"
import { ApiError } from "@pigclaude/api/client"
import { Button } from "@pigclaude/web-ui/components/button"
import { Input } from "@pigclaude/web-ui/components/input"
import { Label } from "@pigclaude/web-ui/components/label"
import { TurnstileCaptcha } from "@pigclaude/web-ui/components/turnstile-captcha"
import { useTurnstileCaptcha } from "@pigclaude/web-ui/hooks/use-turnstile-captcha"
import { identityApi, identityErrorMessage, type IdentityInteraction } from "@/lib/identity-api"
import type { RunIdentityRequest } from "@/lib/identity-interaction-requests"
import { useEmailCodeRequestOwner } from "./use-email-code-request-owner"

/** 服务端未给出冷却秒数时的默认倒计时。 */
const DEFAULT_RESEND_SECONDS = 60

/**
 * 发码前显示人机验证，发码成功后隐藏验证直到用户请求重发或修改收件邮箱。
 * 倒计时采用服务端返回值，429 时继续按 `retryAfterSeconds` 等待。
 */
export function EmailCodeField({
  interaction,
  runRequest,
  email,
  value,
  onChange,
  disabled,
  fieldClass,
  labelClass,
}: {
  interaction: IdentityInteraction
  runRequest: RunIdentityRequest
  email: string
  value: string
  onChange: (value: string) => void
  disabled: boolean
  fieldClass: string
  labelClass: string
}) {
  const [resendIn, setResendIn] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [showCaptcha, setShowCaptcha] = useState(true)
  const beginRequest = useEmailCodeRequestOwner(interaction, email)
  const captcha = useTurnstileCaptcha({
    loadConfig: identityApi.captcha,
    action: "email_code",
  })

  useEffect(() => {
    if (resendIn <= 0) return
    const timer = window.setTimeout(() => setResendIn((seconds) => seconds - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [resendIn])

  // 倒计时绑定当前邮箱；改地址后旧冷却不能继续阻塞新地址的发码。
  useEffect(() => {
    setResendIn(0)
    setError(null)
    setShowCaptcha(true)
  }, [email])

  async function send() {
    if (disabled || resendIn > 0 || email.trim() === "") return
    if (!captcha.ready) {
      setShowCaptcha(true)
      return
    }
    const request = beginRequest()
    if (!request) return
    setError(null)
    try {
      const result = await captcha.run((captchaToken) =>
        runRequest((live) =>
          request.ownsResult()
            ? identityApi.emailCode(live, {
                purpose: "register",
                email,
                ...(captchaToken ? { captchaToken } : {}),
              })
            : Promise.resolve(null),
        ),
      )
      if (!result || !request.ownsResult()) return
      setResendIn(
        result.resendAfterSeconds > 0 ? result.resendAfterSeconds : DEFAULT_RESEND_SECONDS,
      )
      setShowCaptcha(false)
    } catch (reason) {
      if (!request.ownsResult()) return
      if (reason instanceof ApiError && reason.status === 429) {
        const seconds = Number(reason.metadata?.retryAfterSeconds)
        setResendIn(Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_RESEND_SECONDS)
      }
      setError(identityErrorMessage(reason))
    } finally {
      request.release()
    }
  }

  const blocked = disabled || resendIn > 0 || (showCaptcha && !captcha.ready) || email.trim() === ""
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="email-code" className={labelClass}>
        验证码
      </Label>
      <div className="flex items-start gap-2">
        <Input
          id="email-code"
          className={fieldClass}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="6 位数字"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          required
        />
        <Button
          type="button"
          variant="outline"
          className="h-9 shrink-0 text-[13px]"
          disabled={blocked}
          onClick={() => void send()}
        >
          {resendIn > 0 ? `${resendIn} 秒后重发` : "发送验证码"}
        </Button>
      </div>
      {showCaptcha && <TurnstileCaptcha {...captcha.field} />}
      {error && (
        <p role="alert" className="text-[13px] leading-5 text-[var(--danger-ink)]">
          {error}
        </p>
      )}
    </div>
  )
}
