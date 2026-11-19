// 负责中央页一步式邮箱密码表单：验证码门禁、登录/注册提交、密码显隐和底部切换入口。
"use client"

import { useEffect, useState, type FormEvent, type ReactNode } from "react"
import Link from "next/link"
import { Button } from "@pigclaude/web-ui/components/button"
import { Input } from "@pigclaude/web-ui/components/input"
import { Label } from "@pigclaude/web-ui/components/label"
import { LineIcon } from "@pigclaude/web-ui/components/line-icon"
import { TurnstileCaptcha } from "@pigclaude/web-ui/components/turnstile-captcha"
import { useTurnstileCaptcha } from "@pigclaude/web-ui/hooks/use-turnstile-captcha"
import {
  identityApi,
  type IdentityContinuation,
  type IdentityInteraction,
} from "@/lib/identity-api"
import type { RunIdentityRequest } from "@/lib/identity-interaction-requests"
import { EmailCodeField } from "./email-code-field"

/** 中央页表单所处的布局：登录或注册。 */
export type LoginMode = "login" | "register"

const fieldClass =
  "h-9 bg-[var(--input-bg)] dark:bg-[var(--input-bg)] border-border dark:border-border placeholder:text-[var(--meta)] hover:border-[color-mix(in_oklab,var(--fg),transparent_80%)]"
const labelClass = "text-[13px] font-medium text-[var(--fg-2)]"
const linkClass =
  "h-auto rounded-sm p-0 text-[13px] font-medium text-[var(--accent-ink)] underline-offset-4 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"

type LoginVerification = ReturnType<typeof useTurnstileCaptcha>

function PasswordLoginVerification({
  admin,
  children,
}: {
  admin: boolean
  children: (captcha: LoginVerification) => ReactNode
}) {
  const captcha = useTurnstileCaptcha({
    loadConfig: admin ? identityApi.adminCaptcha : identityApi.captcha,
    action: admin ? "admin_login" : "home_login",
  })
  return children(captcha)
}

/**
 * 登录提交使用一次性人机验证；注册时由发码步骤执行人机验证，建号只提交邮箱验证码。
 * 两种提交均经父级 `onMutate` 取得唯一 owner，切换模式沿用同一授权交互。
 */
export function LoginForm({
  interaction,
  runRequest,
  mode,
  onModeChange,
  onForgotPassword,
  onMutate,
  pending,
  disabled,
  initialEmail = "",
  notice = null,
}: {
  interaction: IdentityInteraction
  runRequest: RunIdentityRequest
  mode: LoginMode
  onModeChange: (mode: LoginMode) => void
  onForgotPassword: () => void
  onMutate: (request: (live: IdentityInteraction) => Promise<IdentityContinuation>) => void
  pending: boolean
  disabled: boolean
  /** 重设密码成功后带回来的邮箱，保证用户不必重新输入。 */
  initialEmail?: string
  /** 重设密码成功提示；只在回到登录表单后展示。 */
  notice?: string | null
}) {
  const [showPassword, setShowPassword] = useState(false)
  const [email, setEmail] = useState(initialEmail)
  const [password, setPassword] = useState("")
  const [emailCode, setEmailCode] = useState("")
  const [mailAvailable, setMailAvailable] = useState<boolean | null>(null)
  const admin = interaction.realm === "Admin"
  const register = !admin && interaction.registrationAllowed
  const current: LoginMode = register ? mode : "login"
  useEffect(() => {
    if (current !== "register") return
    let active = true
    setMailAvailable(null)
    void identityApi.mailStatus().then(
      (status) => {
        if (active) setMailAvailable(status.available)
      },
      () => {
        // 读取失败按不可用处理，避免把用户带进必然失败的注册提交。
        if (active) setMailAvailable(false)
      },
    )
    return () => {
      active = false
    }
  }, [current])
  const blocked = pending || disabled
  // 邮件可用性未确认前不允许发码或注册，避免提交必然失败的请求。
  const mailPending = current === "register" && mailAvailable === null
  const codeMissing = current === "register" && !/^\d{6}$/.test(emailCode)
  function renderForm(captcha: LoginVerification | null) {
    const captchaPending = current === "login" && !captcha?.ready
    const submitBlocked = blocked || mailPending || captchaPending || codeMissing
    function submit(event: FormEvent<HTMLFormElement>) {
      event.preventDefault()
      if (submitBlocked) return
      onMutate((live) => {
        const request = (captchaToken?: string) =>
          identityApi.password(live, {
            mode: current,
            email,
            password,
            ...(current === "register" ? { emailCode } : {}),
            ...(captchaToken ? { captchaToken } : {}),
          })
        return captcha ? captcha.run(request) : request()
      })
    }
    return (
      <form className="flex flex-col gap-4" onSubmit={submit} aria-busy={pending} noValidate>
        <div className="flex flex-col gap-2">
          <Label htmlFor="email" className={labelClass}>
            邮箱
          </Label>
          <Input
            id="email"
            type="email"
            className={fieldClass}
            placeholder={admin ? "admin@pigclaude.com" : "you@example.com"}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete={admin ? "username" : "email"}
            spellCheck={false}
            required
          />
        </div>
        {current === "register" && (
          <EmailCodeField
            interaction={interaction}
            runRequest={runRequest}
            email={email}
            value={emailCode}
            onChange={setEmailCode}
            disabled={blocked || mailPending}
            fieldClass={fieldClass}
            labelClass={labelClass}
          />
        )}
        <div className="flex flex-col gap-2">
          <Label htmlFor="password" className={labelClass}>
            密码
          </Label>
          <div className="relative">
            <Input
              id="password"
              className={`${fieldClass} pr-10`}
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={current === "login" ? "current-password" : "new-password"}
              required
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={showPassword ? "隐藏密码" : "显示密码"}
              aria-pressed={showPassword}
              onClick={() => setShowPassword((value) => !value)}
              className="absolute top-1/2 right-2 size-7 -translate-y-1/2 text-muted-foreground hover:bg-[var(--raise-2)] hover:text-foreground dark:hover:bg-[var(--raise-2)]"
            >
              <LineIcon name={showPassword ? "eye-off" : "eye"} className="size-4" />
            </Button>
          </div>
        </div>
        {current === "login" && !admin && (
          <p className="text-right">
            <Button
              type="button"
              variant="link"
              className={linkClass}
              disabled={blocked}
              onClick={onForgotPassword}
            >
              忘记密码？
            </Button>
          </p>
        )}
        {captcha && <TurnstileCaptcha {...captcha.field} />}
        <Button
          type="submit"
          className="mt-1 h-9 w-full font-semibold hover:bg-[var(--btn-primary-hover)] active:bg-[var(--btn-primary-active)]"
          disabled={submitBlocked}
        >
          {pending
            ? current === "register"
              ? "正在创建账号…"
              : "正在登录…"
            : current === "register"
              ? "创建账号"
              : "登录"}
        </Button>
      </form>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {notice && (
        <p role="status" className="text-[13px] leading-5 text-[var(--success-ink)]">
          {notice}
        </p>
      )}
      {current === "login" ? (
        <PasswordLoginVerification admin={admin}>{renderForm}</PasswordLoginVerification>
      ) : mailAvailable === false ? (
        <p className="text-[13px] leading-5 text-muted-foreground">
          邮箱注册暂未开放，可以用 Google 或 GitHub 注册
        </p>
      ) : (
        renderForm(null)
      )}
      {admin ? (
        <p className="text-center">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-sm text-[13px] text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <LineIcon name="arrow-left" className="size-3.5" />
            返回官网
          </Link>
        </p>
      ) : (
        register && (
          <p className="text-center text-[13px] text-muted-foreground">
            <span>{current === "login" ? "还没有账号？" : "已有账号？"}</span>
            <Button
              type="button"
              variant="link"
              className={linkClass}
              disabled={blocked}
              onClick={() => onModeChange(current === "login" ? "register" : "login")}
            >
              {current === "login" ? "注册" : "登录"}
            </Button>
          </p>
        )
      )}
    </div>
  )
}
