// 负责 Home 登录与注册入口：无错误时立即经受信同源 RP start 顶层导航，带错误时只显示提示和重试。
"use client"

import { useEffect, useRef } from "react"
import { useSearchParams } from "next/navigation"
import { Button } from "@pigclaude/web-ui/components/button"
import { beginWebOidcLogin } from "@pigclaude/api/web-oidc"

/** 登录和注册页面的初始 UI 意图。 */
export type AuthMode = "login" | "register"

const errors: Record<string, string> = {
  OIDC_ACCESS_DENIED: "已取消登录，可选择继续登录",
  OIDC_LOGIN_REQUIRED: "请重新登录后继续",
  OIDC_FAILED: "登录未完成，请重试",
  OIDC_UNAVAILABLE: "登录服务暂时不可用，请稍后重试",
  ACCOUNT_BANNED: "账号已被封禁，无法继续登录",
}

/** 无已知错误码时只发起一次登录导航；带错误码时不自动循环，由用户点击「重新登录」。 */
export function AuthPanel({ initialMode = "login" }: { initialMode?: AuthMode } = {}) {
  const params = useSearchParams()
  const errorCode = params.get("oidcError") ?? ""
  const error = Object.hasOwn(errors, errorCode) ? errors[errorCode] : undefined
  const returnTo = params.get("redirect") ?? "/dashboard"
  const started = useRef(false)
  const start = () =>
    beginWebOidcLogin({ site: "home", returnTo, mode: initialMode }, { replace: true })
  useEffect(() => {
    if (error || started.current) return
    started.current = true
    start()
    // 只在挂载时依据首次参数决定是否自动跳转。
  }, [])
  return (
    <section
      className="relative flex w-full max-w-[400px] flex-col items-center gap-4 text-center"
      aria-labelledby="auth-title"
    >
      <h1 id="auth-title" className="sr-only">
        {initialMode === "register" ? "注册 PigClaude" : "登录 PigClaude"}
      </h1>
      {error ? (
        <>
          <p role="alert" className="query-error">
            {error}
          </p>
          <Button onClick={start}>重新登录</Button>
        </>
      ) : (
        <p role="status" className="text-sm text-muted-foreground">
          正在前往登录…
        </p>
      )}
    </section>
  )
}
