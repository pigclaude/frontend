// 负责生成安全的管理员登录回跳地址，并避免把任意外部 URL 带进登录流程。
import { safeRedirectPath } from "@pigclaude/web-ui/lib/safe-redirect"

/** 将当前页面编码为登录后回跳参数，保持 pathname、query 和 hash 完整。 */
export function loginRedirectPath(pathname: string, search = "", hash = ""): string {
  const target = `${pathname || "/"}${search}${hash}`
  return `/login?redirect=${encodeURIComponent(target)}`
}

/** 判断登录回跳值是否为同源绝对路径，拒绝协议相对和外部 URL。 */
export function safeLoginRedirect(value: string | null): string {
  return safeRedirectPath(value, "/users")
}

let redirecting = false

/** 从任意 401 查询或 mutation 统一跳回登录并保留原始页面。 */
export function redirectToLogin(): void {
  if (typeof window === "undefined" || window.location.pathname === "/login" || redirecting) {
    return
  }
  redirecting = true
  window.location.replace(
    loginRedirectPath(window.location.pathname, window.location.search, window.location.hash),
  )
}
