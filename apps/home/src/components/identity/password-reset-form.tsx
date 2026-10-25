// 负责忘记密码三步流程：邮箱发码、验证码与两次新密码、完成后交回父级恢复登录表单。
"use client"

import { useEffect, useState, type FormEvent } from "react"
import { ApiError } from "@pigclaude/api/client"
import { Button } from "@pigclaude/web-ui/components/button"
import { Input } from "@pigclaude/web-ui/components/input"
import { Label } from "@pigclaude/web-ui/components/label"
import { TurnstileCaptcha } from "@pigclaude/web-ui/components/turnstile-captcha"
import { useTurnstileCaptcha } from "@pigclaude/web-ui/hooks/use-turnstile-captcha"
import { identityApi, identityErrorMessage, type IdentityInteraction } from "@/lib/identity-api"

/** 服务端未给出冷却秒数时的默认倒计时。 */
const DEFAULT_RESEND_SECONDS = 60
const fieldClass =
  "h-9 bg-[var(--input-bg)] dark:bg-[var(--input-bg)] border-border dark:border-border placeholder:text-[var(--meta)] hover:border-[color-mix(in_oklab,var(--fg),transparent_80%)]"
const labelClass = "text-[13px] font-medium text-[var(--fg-2)]"
const linkClass =
  "h-auto rounded-sm p-0 text-[13px] font-medium text-[var(--accent-ink)] underline-offset-4 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"

/** 重设流程只包含邮箱发码和验证码提交两个可见步骤。 */
type ResetStep = "email" | "code"

/**
 * 在同一个登录交互内完成忘记密码：发码沿用 60 秒冷却和 429 等待，
 * 提交前本地校验验证码、两次密码与 8–1024 长度；成功后只把邮箱交回登录表单。
 */
export function PasswordResetForm({
  interaction,
  disabled,
  onCancel,
  onDone,
}: {
  interaction: IdentityInteraction
  disabled: boolean
  onCancel: () => void
  onDone: (email: string) => void
}) {
  const [step, setStep] = useState<ResetStep>("email")
  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const [password, setPassword] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [resendIn, setResendIn] = useState(0)
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

  const blocked = disabled || pending
  const trimmedEmail = email.trim()
  const codeMissing = !/^\d{6}$/.test(code)

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (blocked || resendIn > 0 || !captcha.ready || trimmedEmail === "") return
    setPending(true)
    setError(null)
    try {
      const result = await captcha.run((captchaToken) =>
        identityApi.emailCode(interaction, {
          purpose: "reset_password",
          email: trimmedEmail,
          ...(captchaToken ? { captchaToken } : {}),
        }),
      )
      setResendIn(
        result.resendAfterSeconds > 0 ? result.resendAfterSeconds : DEFAULT_RESEND_SECONDS,
      )
      setStep("code")
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 429) {
        const seconds = Number(reason.metadata?.retryAfterSeconds)
        setResendIn(Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_RESEND_SECONDS)
      }
      setError(identityErrorMessage(reason))
    } finally {
      setPending(false)
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (blocked) return
    if (codeMissing) {
      setError("请输入 6 位数字验证码")
      return
    }
    const length = [...password].length
    if (length < 8 || length > 1024) {
      setError("密码长度需为 8–1024 个字符")
      return
    }
    if (password !== confirmation) {
      setError("两次输入的密码不一致")
      return
    }
    setPending(true)
    setError(null)
    // 成功只回到登录表单；不创建会话，也不推进当前交互。
    void identityApi
      .resetPassword(interaction, {
        email: trimmedEmail,
        emailCode: code,
        newPassword: password,
      })
      .then(
        () => onDone(trimmedEmail),
        (reason: unknown) => {
          setError(identityErrorMessage(reason))
          setPending(false)
        },
      )
  }

  return (
    <div className="flex flex-col gap-4">
      {step === "email" ? (
        <form className="flex flex-col gap-4" onSubmit={send} aria-busy={pending} noValidate>
          <div className="flex flex-col gap-2">
            <Label htmlFor="reset-email" className={labelClass}>
              邮箱
            </Label>
            <Input
              id="reset-email"
              type="email"
              className={fieldClass}
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              spellCheck={false}
              required
            />
          </div>
          <TurnstileCaptcha {...captcha.field} />
          <Button
            type="submit"
            className="mt-1 h-9 w-full font-semibold hover:bg-[var(--btn-primary-hover)] active:bg-[var(--btn-primary-active)]"
            disabled={blocked || resendIn > 0 || !captcha.ready || trimmedEmail === ""}
          >
            {resendIn > 0 ? `${resendIn} 秒后重发` : "发送验证码"}
          </Button>
          <p className="text-center">
            <Button
              type="button"
              variant="link"
              className={linkClass}
              disabled={blocked}
              onClick={onCancel}
            >
              返回登录
            </Button>
          </p>
        </form>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={submit} aria-busy={pending} noValidate>
          <p className="text-[13px] leading-5 text-muted-foreground">
            验证码已发送至 {trimmedEmail}
          </p>
          <div className="flex flex-col gap-2">
            <Label htmlFor="reset-code" className={labelClass}>
              验证码
            </Label>
            <Input
              id="reset-code"
              className={fieldClass}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="6 位数字"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="reset-password" className={labelClass}>
              新密码
            </Label>
            <Input
              id="reset-password"
              className={fieldClass}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="reset-confirmation" className={labelClass}>
              确认新密码
            </Label>
            <Input
              id="reset-confirmation"
              className={fieldClass}
              type="password"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="new-password"
              required
            />
          </div>
          <Button
            type="submit"
            className="mt-1 h-9 w-full font-semibold hover:bg-[var(--btn-primary-hover)] active:bg-[var(--btn-primary-active)]"
            disabled={blocked || codeMissing || password === "" || confirmation === ""}
          >
            {pending ? "正在重设密码…" : "重设密码"}
          </Button>
          <div className="flex items-center justify-between">
            <Button
              type="button"
              variant="link"
              className={linkClass}
              disabled={blocked}
              onClick={() => {
                setError(null)
                setStep("email")
              }}
            >
              上一步
            </Button>
            <Button
              type="button"
              variant="link"
              className={linkClass}
              disabled={blocked}
              onClick={onCancel}
            >
              返回登录
            </Button>
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="text-[13px] leading-5 text-[var(--danger-ink)]">
          {error}
        </p>
      )}
    </div>
  )
}
