// 负责把主进程的授权事件状态换成界面判断与可读文案：哪些状态算失败、失败时显示什么。
import { desktopText } from "../locale/text"
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
    cancelled: desktopText("flows.authorization-status.1"),
    denied: desktopText("flows.authorization-status.2"),
    expired: desktopText("flows.authorization-status.3"),
    "state-mismatch": desktopText("flows.authorization-status.4"),
    "proxy-mismatch": desktopText("flows.authorization-status.5"),
    "network-error": desktopText("flows.authorization-status.6"),
    "exchange-error": desktopText("flows.authorization-status.7"),
  }
  return messages[status] ?? desktopText("flows.authorization-status.8")
}

/** 授权请求抛出的错误换成可读文案。 */
export function authorizationErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : desktopText("flows.authorization-status.9")
}
