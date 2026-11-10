// 保存未确认回收的原生诊断资源，跨准备失败与后续重试维持所有权。

/** 清理未确认时携带重试句柄，不能丢掉仍归本轮拥有的资源。 */
export class NativeDiagnosticCleanupError extends Error {
  readonly cleanup: () => Promise<void>

  /** 保留清理操作及可选内部原因，公开消息不含凭据或私有路径。 */
  constructor(cleanup: () => Promise<void>, options?: ErrorOptions) {
    super("本轮原生诊断资源尚未确认回收", options)
    this.cleanup = cleanup
  }
}
