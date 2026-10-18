// 负责登录和注册表单，提交只通过 homeApi 并刷新权威会话查询。
"use client"

import { useEffect, useState, type FormEvent } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Button } from "@pigclaude/web-ui/components/button"
import { Eye, EyeOff } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@pigclaude/web-ui/components/tabs"
import { Label } from "@pigclaude/web-ui/components/label"
import { Input } from "@pigclaude/web-ui/components/input"
import { ApiError } from "@pigclaude/api/client"
import { homeApi } from "@/lib/api"

/** 登录和注册表单所需的模式。 */
export type AuthMode = "login" | "register"

function safeRedirect(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/dashboard"
  return value
}

/** 渲染登录/注册切换，并在成功后刷新 user/me 与 entitlement。 */
export function AuthPanel({ initialMode }: { initialMode?: AuthMode } = {}) {
  const params = useSearchParams()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<AuthMode>(
    initialMode ?? (params.get("tab") === "register" ? "register" : "login"),
  )
  useEffect(() => {
    setMode(initialMode ?? (params.get("tab") === "register" ? "register" : "login"))
  }, [initialMode, params])
  const [showPassword, setShowPassword] = useState(false)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [nickname, setNickname] = useState("")
  const [error, setError] = useState<string | null>(null)

  const authMutation = useMutation({
    mutationFn: async (values: { email: string; password: string; nickname: string }) => {
      if (mode === "login")
        return homeApi.auth.login({ email: values.email, password: values.password })
      return homeApi.auth.register(values)
    },
    onSuccess: async () => {
      setError(null)
      await Promise.all([
        queryClient.fetchQuery({ queryKey: ["me"], queryFn: homeApi.user.me }),
        queryClient.fetchQuery({
          queryKey: ["entitlement"],
          queryFn: homeApi.membership.entitlement,
        }),
      ])
      router.push(safeRedirect(params.get("redirect")))
    },
    onError: (reason) => {
      setError(reason instanceof ApiError ? reason.message : "请求失败，请稍后重试")
    },
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    authMutation.mutate({ email, password, nickname })
  }

  return (
    <section
      className="relative flex w-full max-w-[400px] flex-col gap-6"
      aria-labelledby="auth-title"
    >
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 id="auth-title" className="text-xl font-semibold tracking-[-0.288px]">
          {mode === "login" ? "登录 PigClaude" : "注册 PigClaude"}
        </h1>
        <p className="text-sm text-muted-foreground">使用 PigClaude 账号管理会员和桌面设备。</p>
      </div>
      <Tabs
        value={mode}
        onValueChange={(value) => setMode(value === "register" ? "register" : "login")}
        activationMode="manual"
      >
        <TabsList
          aria-label="登录或注册"
          className="auth-tabs grid w-full grid-cols-2 gap-1 rounded-md border border-border bg-[var(--raise-1)] p-1 group-data-[orientation=horizontal]/tabs:h-auto"
        >
          <TabsTrigger
            value="login"
            disabled={authMutation.isPending}
            className="h-[34px] rounded-sm text-muted-foreground"
          >
            登录
          </TabsTrigger>
          <TabsTrigger
            value="register"
            disabled={authMutation.isPending}
            className="h-[34px] rounded-sm text-muted-foreground"
          >
            注册
          </TabsTrigger>
        </TabsList>
        <TabsContent value={mode} tabIndex={-1}>
          <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
            {mode === "register" && (
              <div className="flex flex-col gap-1.5">
                <Label className="text-[var(--fg-2)]" htmlFor="nickname">
                  昵称
                </Label>
                <Input
                  placeholder="如何称呼你"
                  id="nickname"
                  value={nickname}
                  onChange={(event) => setNickname(event.target.value)}
                  required
                  autoComplete="nickname"
                />
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Label className="text-[var(--fg-2)]" htmlFor="email">
                邮箱
              </Label>
              <Input
                placeholder="name@example.com"
                id="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                autoComplete="email"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-[var(--fg-2)]" htmlFor="password">
                密码
              </Label>
              <div className="relative">
                <Input
                  placeholder="输入你的密码"
                  className="pr-10"
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={showPassword ? "隐藏密码" : "显示密码"}
                  onClick={() => setShowPassword((value) => !value)}
                  className="absolute top-1/2 right-1.5 size-7 -translate-y-1/2 text-[var(--meta)] hover:bg-[var(--raise-2)] hover:text-foreground dark:hover:bg-[var(--raise-2)]"
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </Button>
              </div>
            </div>
            {error && (
              <p role="alert" className="query-error">
                {error}
              </p>
            )}
            <Button className="w-full" type="submit" disabled={authMutation.isPending}>
              {authMutation.isPending ? "提交中…" : mode === "login" ? "登录" : "创建账号"}
            </Button>
          </form>
        </TabsContent>
      </Tabs>
      <p className="text-center text-sm text-muted-foreground">
        登录后可查看会员权益，并从桌面客户端继续设备授权。
      </p>
    </section>
  )
}
