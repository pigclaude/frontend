// 负责账号治理状态及无损版本响应契约。
/** 用户账号状态独立于会员和管理员状态。 */
export type AccountStatus = "active" | "banned"
/** 用户账号治理视图中的版本始终保留服务端十进制字符串。 */
export interface UserAccountView {
  status: AccountStatus
  authVersion: string
}
/** 管理治理成功结果只包含目标、当前状态和新版本。 */
export interface AccountModerationView extends UserAccountView {
  userId: string
}
