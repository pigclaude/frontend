// 负责 home 会话查询键和 401 恢复策略，避免业务接口抖动误登出。
import { ApiError } from "@pigclaude/api"

export const ME_QUERY_KEY = ["me"] as const
export const ENTITLEMENT_QUERY_KEY = ["entitlement"] as const
export const HOME_SESSION_REVALIDATE_EVENT = "pigclaude:home-session-revalidate"

export type UnauthorizedQueryAction = "ignore" | "redirect" | "revalidate"

/** 判断无需登录即可访问的 home 路径。 */
export function isPublicHomePath(pathname: string): boolean {
  return ["/", "/login", "/register"].includes(pathname)
}

/** 将权威 me 401 与业务查询 401 分开处理。 */
export function unauthorizedQueryAction(
  error: unknown,
  queryKey: readonly unknown[],
  pathname?: string,
): UnauthorizedQueryAction {
  if (!(error instanceof ApiError) || error.status !== 401) return "ignore"
  if (pathname !== undefined && isPublicHomePath(pathname)) return "ignore"
  return queryKey.length === 1 && queryKey[0] === ME_QUERY_KEY[0] ? "redirect" : "revalidate"
}

/** 请求 app shell 重新验证会话，返回是否成功派发浏览器事件。 */
export function requestHomeSessionRevalidation(): boolean {
  if (typeof window === "undefined" || window.location.pathname === "/login") return false
  window.dispatchEvent(new Event(HOME_SESSION_REVALIDATE_EVENT))
  return true
}
