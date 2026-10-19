// 负责 OP 密码登录与注册表单，复用一次性验证码和密码显隐。
"use client"

import { useEffect, useRef, useState, type FormEvent } from "react"
import { Eye, EyeOff } from "lucide-react"
import { consumeRegistrationHint } from "@pigclaude/api/web-oidc"
import { Button } from "@pigclaude/web-ui/components/button"
import { Input } from "@pigclaude/web-ui/components/input"
import { Label } from "@pigclaude/web-ui/components/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@pigclaude/web-ui/components/tabs"
import { TurnstileCaptcha } from "@pigclaude/web-ui/components/turnstile-captcha"
import { useTurnstileCaptcha } from "@pigclaude/web-ui/hooks/use-turnstile-captcha"
import {
  identityApi,
  identityErrorMessage,
  type IdentityContinuation,
  type IdentityInteraction,
} from "@/lib/identity-api"

/** 密码认证失败会更新 challenge；注册模式只按服务器开放能力启用。 */
export function PasswordInteraction({
  interaction,
  onContinue,
  disabled = false,
}: {
  interaction: IdentityInteraction
  onContinue: (result: IdentityContinuation) => void
  disabled?: boolean
}) {
  const [mode, setMode] = useState<"login" | "register">("login")
  const [showPassword, setShowPassword] = useState(false)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const submitting = useRef(false)
  const hintRead = useRef(false)
  const register = interaction.realm === "User" && interaction.registrationAllowed
  useEffect(() => {
    if (hintRead.current) return
    hintRead.current = true
    if (register && consumeRegistrationHint()) setMode("register")
  }, [register])
  const captcha = useTurnstileCaptcha({
    loadConfig: interaction.realm === "Admin" ? identityApi.adminCaptcha : identityApi.captcha,
    action:
      interaction.realm === "Admin"
        ? "admin_login"
        : mode === "register"
          ? "home_register"
          : "home_login",
  })
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (disabled || submitting.current || !captcha.ready) return
    submitting.current = true
    setPending(true)
    setError(null)
    try {
      const result = await captcha.run((captchaToken) =>
        identityApi.password(interaction, {
          mode,
          email,
          password,
          ...(captchaToken ? { captchaToken } : {}),
        }),
      )
      setPassword("")
      onContinue(result)
    } catch (reason) {
      setError(identityErrorMessage(reason))
    } finally {
      submitting.current = false
      setPending(false)
    }
  }
  return (
    <Tabs
      value={mode}
      onValueChange={(value) => {
        setMode(register && value === "register" ? "register" : "login")
        setError(null)
      }}
      activationMode="manual"
      className="gap-6"
    >
      {register && (
        <TabsList
          aria-label="登录或注册"
          className="auth-tabs grid w-full grid-cols-2 gap-1 rounded-md border border-border p-1"
        >
          <TabsTrigger value="login" disabled={pending || disabled}>
            登录
          </TabsTrigger>
          <TabsTrigger value="register" disabled={pending || disabled}>
            注册
          </TabsTrigger>
        </TabsList>
      )}
      <TabsContent value={mode} tabIndex={-1}>
        <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">邮箱</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">密码</Label>
            <div className="relative">
              <Input
                id="password"
                className="pr-10"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                required
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={showPassword ? "隐藏密码" : "显示密码"}
                onClick={() => setShowPassword((value) => !value)}
                className="absolute top-1/2 right-1.5 -translate-y-1/2"
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </Button>
            </div>
          </div>
          <TurnstileCaptcha {...captcha.field} />
          {error && (
            <p role="alert" className="query-error">
              {error}
            </p>
          )}
          <Button type="submit" disabled={pending || disabled || !captcha.ready}>
            {pending ? "提交中…" : mode === "login" ? "登录" : "创建账号"}
          </Button>
        </form>
      </TabsContent>
    </Tabs>
  )
}
