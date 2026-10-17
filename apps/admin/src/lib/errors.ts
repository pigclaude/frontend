// 负责把共享 API 错误转换为稳定、可读的管理后台 toast 文案。
import { ApiError } from "@pigclaude/api/client"
import { toast } from "sonner"

/** 显示 API 失败原因，保证失败 mutation 不伪造成功反馈。 */
export function toastApiError(error: unknown): void {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      toast.error("管理员登录已失效，请重新登录")
      return
    }
    if (error.status === 403) {
      toast.error("当前管理员没有执行此操作的权限")
      return
    }
    toast.error(error.reason || error.message)
    return
  }
  toast.error(error instanceof Error ? error.message : "请求失败，请稍后重试")
}
