// 负责管理员账号治理严格 JSON，CSRF 始终位于正式 body。
import type { HttpClient } from "../client"
import { createAdminSessionWriter } from "./session"
import type { AccountModerationView } from "@pigclaude/contracts/account-status"
/** 治理提交保留期望版本与操作者原始理由，不 trim 或 Number 转换。 */
export interface AccountModerationInput {
  expectedAuthVersion: string
  reason: string
}
/** 三种账号操作使用相同真实 Admin RP writer 及当前 UI owner。 */
export function createAccountModerationApi(client: HttpClient) {
  const write = createAdminSessionWriter(client)
  return {
    /** 仅当前 active 账号可封禁。 */
    ban: (userId: string, body: AccountModerationInput, owner: () => boolean) =>
      write<AccountModerationView>(
        "POST",
        `/admin/v1/users/${encodeURIComponent(userId)}/ban`,
        body,
        "body",
        owner,
      ),
    /** 解封只恢复账号状态，不恢复任何旧凭据。 */
    unban: (userId: string, body: AccountModerationInput, owner: () => boolean) =>
      write<AccountModerationView>(
        "POST",
        `/admin/v1/users/${encodeURIComponent(userId)}/unban`,
        body,
        "body",
        owner,
      ),
    /** 强制下线保持账号状态，由服务器递增账号版本。 */
    revokeSessions: (userId: string, body: AccountModerationInput, owner: () => boolean) =>
      write<AccountModerationView>(
        "POST",
        `/admin/v1/users/${encodeURIComponent(userId)}/sessions/revoke`,
        body,
        "body",
        owner,
      ),
  }
}
