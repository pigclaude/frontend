// 负责账号治理和设备关系操作的固定错误反馈，不显示内部理由或异常原文。
import { ApiError } from "@pigclaude/api/client"
/** 业务拒绝保持可恢复；409 后必须读取新快照并由操作者重新选择。 */
export function accountOperationError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409) return "账号或设备状态已变化，请刷新后重新选择操作"
    if (error.status === 403) return "当前权限或会话校验不允许此操作，请刷新后重试"
    if (error.status === 400) return "请求无效，请检查操作原因（1–500 个字符）后重试"
    if (error.status === 401) return "管理员会话已失效，请重新登录"
  }
  return "操作失败，请稍后重试"
}
