// 标识账号选择因 CLI 环境不兼容而失败，避免误报代理故障或继续发送到其他环境。

/** 没有与当前 CLI 兼容的账号时抛出，由 daemon 返回固定错误标记。 */
export class AccountEnvironmentMismatchError extends Error {
  /** 固定错误不附带账号凭据或代理材料。 */
  constructor() {
    super("account_environment_mismatch")
  }
}
