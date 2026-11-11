// 负责把主进程的授权事件状态换成界面判断与可读文案：哪些状态算失败、失败时显示什么。
import type { AuthorizationStateEvent } from "../../../main/authorization/types"

const failures: ReadonlySet<AuthorizationStateEvent["status"]> = new Set([
  "cancelled",
  "denied",
  "expired",
  "state-mismatch",
  "proxy-mismatch",
  "network-error",
  "exchange-error",
])

/** 授权事件是不是一次失败（取消、拒绝、过期、校验失败、网络或交换出错）。 */
export function isAuthorizationFailure(event: AuthorizationStateEvent): boolean {
  return failures.has(event.status)
}

/** 授权状态的可读文案；没有专门文案的状态返回「授权未完成」。 */
export function authorizationStatusText(status: AuthorizationStateEvent["status"]): string {
  const messages: Partial<Record<AuthorizationStateEvent["status"], string>> = {
    cancelled: "已取消授权",
    denied: "浏览器拒绝了授权",
    expired: "授权链接已过期",
    "state-mismatch": "授权回调校验失败",
    "proxy-mismatch": "登录出口不一致",
    "network-error": "授权服务不可用",
    "exchange-error": "授权码交换失败",
  }
  return messages[status] ?? "授权未完成"
}

/** 授权请求抛出的错误换成可读文案。 */
export function authorizationErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "授权服务不可用"
}
