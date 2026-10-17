// 负责登录和注册表单，提交只通过 homeApi 并刷新权威会话查询。
"use client"

import { useState, type FormEvent } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import { Button } from "@pigclaude/web-ui/components/button"
import { Input } from "@pigclaude/web-ui/components/input"
import { ApiError } from "@pigclaude/api"
import { homeApi } from "@/lib/api"

/** 登录和注册表单所需的模式。 */
export type AuthMode = "login" | "register"

/** 渲染登录/注册切换，并在成功后刷新 user/me 与 entitlement。 */
export function AuthPanel({ initialMode }: { initialMode?: AuthMode } = {}) {
  const params = useSearchParams()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<AuthMode>(
    initialMode ?? (params.get("tab") === "register" ? "register" : "login"),
  )
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [nickname, setNickname] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function refreshSession() {
    await Promise.all([
      queryClient.fetchQuery({ queryKey: ["me"], queryFn: homeApi.user.me }),
      queryClient.fetchQuery({
        queryKey: ["entitlement"],
        queryFn: homeApi.membership.entitlement,
      }),
    ])
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      if (mode === "login") await homeApi.auth.login({ email, password })
      else await homeApi.auth.register({ email, password, nickname })
      await refreshSession()
      router.push("/dashboard")
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "请求失败，请稍后重试")
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="auth-card" aria-labelledby="auth-title">
      <h1 id="auth-title">{mode === "login" ? "登录 PigClaude" : "注册 PigClaude"}</h1>
      <p className="muted">使用 PigClaude 账号管理会员和桌面设备。</p>
      <div className="auth-tabs" role="tablist" aria-label="登录或注册">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "login"}
          onClick={() => setMode("login")}
        >
          登录
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "register"}
          onClick={() => setMode("register")}
        >
          注册
        </button>
      </div>
      <form className="stack" onSubmit={submit} noValidate>
        {mode === "register" && (
          <div className="form-field">
            <label htmlFor="nickname">昵称</label>
            <Input
              id="nickname"
              value={nickname}
              onChange={(event) => setNickname(event.target.value)}
              required
              autoComplete="nickname"
            />
          </div>
        )}
        <div className="form-field">
          <label htmlFor="email">邮箱</label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            autoComplete="email"
          />
        </div>
        <div className="form-field">
          <label htmlFor="password">密码</label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            autoComplete={mode === "login" ? "current-password" : "new-password"}
          />
        </div>
        {error && (
          <p role="alert" className="query-error">
            {error}
          </p>
        )}
        <Button type="submit" disabled={pending}>
          {pending ? "提交中…" : mode === "login" ? "登录" : "创建账号"}
        </Button>
      </form>
    </section>
  )
}
