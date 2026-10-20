// 负责中央页一步式邮箱密码表单：验证码门禁、登录/注册提交、密码显隐和底部切换入口。
"use client"

import { useState, type FormEvent } from "react"
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

/** 中央页表单所处的布局：登录或注册。 */
export type LoginMode = "login" | "register"

const fieldClass =
  "h-9 bg-[var(--input-bg)] dark:bg-[var(--input-bg)] border-border dark:border-border placeholder:text-[var(--meta)] hover:border-[color-mix(in_oklab,var(--fg),transparent_80%)]"
const labelClass = "text-[13px] font-medium text-[var(--fg-2)]"
const linkClass =
  "h-auto rounded-sm p-0 text-[13px] font-medium text-[var(--accent-ink)] underline-offset-4 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"

/**
 * 渲染邮箱、密码、人机验证和主按钮；每次提交都经父级 `onMutate` 取得唯一 mutation owner，
 * 验证码 token 一次性使用。`onModeChange` 只切换同一交互内的布局，不重新发起授权。
 */
export function LoginForm({
  interaction,
  mode,
  onModeChange,
  onMutate,
  pending,
  disabled,
}: {
  interaction: IdentityInteraction
  mode: LoginMode
  onModeChange: (mode: LoginMode) => void
  onMutate: (request: () => Promise<IdentityContinuation>) => void
  pending: boolean
  disabled: boolean
}) {
  const [showPassword, setShowPassword] = useState(false)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const admin = interaction.realm === "Admin"
  const register = !admin && interaction.registrationAllowed
  const current: LoginMode = register ? mode : "login"
  const captcha = useTurnstileCaptcha({
    loadConfig: admin ? identityApi.adminCaptcha : identityApi.captcha,
    action: admin ? "admin_login" : current === "register" ? "home_register" : "home_login",
  })
  const blocked = pending || disabled
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (blocked || !captcha.ready) return
    // 父级同步取得当前交互 owner，密码与其他 mutation 共用同一排他门禁。
    onMutate(() =>
      captcha.run((captchaToken) =>
        identityApi.password(interaction, {
          mode: current,
          email,
          password,
          ...(captchaToken ? { captchaToken } : {}),
        }),
      ),
    )
  }
  return (
    <div className="flex flex-col gap-6">
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
        <TurnstileCaptcha {...captcha.field} />
        <Button
          type="submit"
          className="mt-1 h-9 w-full font-semibold hover:bg-[var(--btn-primary-hover)] active:bg-[var(--btn-primary-active)]"
          disabled={blocked || !captcha.ready}
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
