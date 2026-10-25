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

/** 服务端未给出冷却秒数时的默认倒计时。 */
const DEFAULT_RESEND_SECONDS = 60

/**
 * 渲染验证码行和独立的人机验证；发送成功后按服务端秒数倒计时，429 时采用
 * `retryAfterSeconds` 继续等待，避免把限流伪装成普通失败。
 */
export function EmailCodeField({
  interaction,
  email,
  value,
  onChange,
  disabled,
  fieldClass,
  labelClass,
}: {
  interaction: IdentityInteraction
  email: string
  value: string
  onChange: (value: string) => void
  disabled: boolean
  fieldClass: string
  labelClass: string
}) {
  const [resendIn, setResendIn] = useState(0)
  const [error, setError] = useState<string | null>(null)
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
  }, [email])

  async function send() {
    if (disabled || resendIn > 0 || !captcha.ready || email.trim() === "") return
    setError(null)
    try {
      const result = await captcha.run((captchaToken) =>
        identityApi.emailCode(interaction, {
          purpose: "register",
          email,
          ...(captchaToken ? { captchaToken } : {}),
        }),
      )
      setResendIn(
        result.resendAfterSeconds > 0 ? result.resendAfterSeconds : DEFAULT_RESEND_SECONDS,
      )
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 429) {
        const seconds = Number(reason.metadata?.retryAfterSeconds)
        setResendIn(Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_RESEND_SECONDS)
      }
      setError(identityErrorMessage(reason))
    }
  }

  const blocked = disabled || resendIn > 0 || !captcha.ready || email.trim() === ""
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
      <TurnstileCaptcha {...captcha.field} />
      {error && (
        <p role="alert" className="text-[13px] leading-5 text-[var(--danger-ink)]">
          {error}
        </p>
      )}
    </div>
  )
}
