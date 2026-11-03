// 定义 Xray 启动失败且子进程回收未确认时的错误。

import { ClaudeAccountError } from "./errors"

/** 启动失败后仍需重试清理的 Xray 错误。 */
export class XrayStartupCleanupError extends ClaudeAccountError {
  readonly cleanup: () => Promise<void>

  /** 保留清理函数，避免在旧进程未确认退出前重复启动。 */
  constructor(cleanup: () => Promise<void>) {
    super("PROXY_UNAVAILABLE", "Xray 启动失败且进程尚未确认退出")
    this.cleanup = cleanup
  }
}

/** Xray 首次启动时本机监听端口已被占用。 */
export class XrayPortInUseError extends ClaudeAccountError {
  /** 创建不包含代理凭据的端口占用错误。 */
  constructor() {
    super("PROXY_UNAVAILABLE", "Xray 本机端口已被占用")
  }
}
