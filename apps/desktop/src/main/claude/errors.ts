// 负责定义 Claude 账号服务的稳定错误，错误消息不包含凭据。

import type { ClaudeAccountErrorCode } from "@pigclaude/contracts/claude-account"

/** Claude 账号服务错误。保证 code 来自公开契约，message 可直接展示给用户。 */
export class ClaudeAccountError extends Error {
  readonly code: ClaudeAccountErrorCode

  /** 创建带稳定错误码的账号服务错误。 */
  constructor(code: ClaudeAccountErrorCode, message: string) {
    super(message)
    this.name = "ClaudeAccountError"
    this.code = code
  }
}
