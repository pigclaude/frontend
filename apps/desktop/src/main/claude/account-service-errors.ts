// 负责将账号服务依赖的错误映射到公开错误和事件阶段。

import type {
  ClaudeAccountErrorCode,
  ClaudeAccountEvent,
} from "@pigclaude/contracts/claude-account"
import { ClaudeAccountError } from "./errors"
import { BrowserLaunchError } from "./fingerprint-chromium"
import { BrowserProcessExitedError } from "./browser-control-pipe"
import { SubscriptionOAuthError } from "./subscription-oauth"

/** 将外部错误映射为账号服务稳定错误。 */
export function mapError(error: unknown): ClaudeAccountError {
  if (error instanceof ClaudeAccountError) return error
  if (error instanceof BrowserProcessExitedError) {
    return new ClaudeAccountError("AUTHORIZATION_CANCELLED", error.message)
  }
  if (error instanceof BrowserLaunchError) {
    return new ClaudeAccountError(error.code, error.message)
  }
  if (error instanceof SubscriptionOAuthError) {
    return new ClaudeAccountError(error.code, error.message)
  }
  return new ClaudeAccountError("UNEXPECTED_ERROR", "Claude 账号操作失败")
}

/** 按稳定错误码选择授权事件阶段。 */
export function phaseFor(code: ClaudeAccountErrorCode): ClaudeAccountEvent["phase"] {
  if (code === "AUTHORIZATION_CANCELLED") return "cancelled"
  if (
    code === "EGRESS_MISMATCH" ||
    code === "EGRESS_CHECK_FAILED" ||
    code === "PROXY_UNAVAILABLE" ||
    code === "PROXY_INVALID" ||
    code === "UNSUPPORTED_PROXY_SCHEME" ||
    code.startsWith("BROWSER_")
  ) {
    return "blocked"
  }
  return "failed"
}

/** 校验会员状态，并将非领域错误转换为稳定的会员错误。 */
export async function requireMembership(check: () => Promise<void>): Promise<void> {
  try {
    await check()
  } catch (error: unknown) {
    if (error instanceof ClaudeAccountError) throw error
    throw new ClaudeAccountError("MEMBERSHIP_REQUIRED", "会员校验不通过")
  }
}
