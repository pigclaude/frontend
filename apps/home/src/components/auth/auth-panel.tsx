// 负责 Home 登录与注册入口，只通过受信同源 RP start 发起顶层导航。
"use client"

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

/** 等待用户明确继续，退出或错误返回后不会自动循环授权。 */
export function AuthPanel({ initialMode = "login" }: { initialMode?: AuthMode } = {}) {
  const params = useSearchParams()
  const error = errors[params.get("oidcError") ?? ""]
  const returnTo = params.get("redirect") ?? "/dashboard"
  const alternateQuery = new URLSearchParams({ redirect: returnTo })
  const alternatePath = initialMode === "register" ? "/login" : "/register"
  return (
    <section
      className="relative flex w-full max-w-[400px] flex-col gap-6"
      aria-labelledby="auth-title"
    >
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 id="auth-title" className="text-xl font-semibold tracking-[-0.288px]">
          {initialMode === "register" ? "注册 PigClaude" : "登录 PigClaude"}
        </h1>
        <p className="text-sm text-muted-foreground">使用 PigClaude 账号管理会员和桌面设备。</p>
      </div>
      {error && (
        <p role="alert" className="query-error">
          {error}
        </p>
      )}
      <Button
        onClick={() =>
          beginWebOidcLogin({
            site: "home",
            returnTo,
            mode: initialMode,
          })
        }
      >
        {initialMode === "register" ? "继续注册" : "继续登录"}
      </Button>
      <a
        className="text-center text-sm text-muted-foreground"
        href={`${alternatePath}?${alternateQuery}`}
      >
        {initialMode === "register" ? "已有账号？登录" : "创建账号"}
      </a>
    </section>
  )
}
