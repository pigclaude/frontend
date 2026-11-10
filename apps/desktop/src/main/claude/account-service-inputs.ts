// 定义 Claude 账号授权、修改和导入的输入约束。

import type { ClaudeFingerprintView } from "@pigclaude/contracts/claude-account"

/** 添加或重新授权 Claude 账号的输入。proxyId 为 null 表示使用系统网络。 */
export type AuthorizeClaudeAccountInput = {
  accountId?: string
  displayName: string
} & (
  | { browserProfileId: string; proxyId?: never; fingerprint?: never }
  | { browserProfileId?: undefined; proxyId: string | null; fingerprint: ClaudeFingerprintView }
)

/** 修改账号设置的输入。proxyId 省略表示不变，null 表示解绑并使用系统网络。 */
export type UpdateClaudeAccountInput = {
  accountId: string
  browserProfileId?: string
  displayName?: string
  enabled?: boolean
  proxyId?: string | null
  fingerprint?: ClaudeFingerprintView
}

/** 从 Claude CLI 导入账号的输入。confirmCopy 必须为 true，表示用户已确认复制凭据。 */
export type ImportClaudeCliAccountInput = {
  confirmCopy: boolean
  displayName?: string
  browserProfileId?: string
}
