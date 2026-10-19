// 负责本人设备 facade 与固定安全反馈，未知服务端原文不直接显示。
import { ApiError } from "@pigclaude/api/client"
import { createUserDevicesApi } from "@pigclaude/api/home/devices"
import { homeClient } from "@/lib/api"
import { identityManagementError } from "../identity/identity-management"
/** 设备管理只使用 Home 当前 Cookie client。 */
export const userDevices = createUserDevicesApi(homeClient)
/** 设备冲突需重新读取，不能拿旧 epoch 自动重放。 */
export function deviceManagementError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409) return "设备关系已变化，已刷新列表，请重新选择操作"
    if (error.code === "access_denied") return "需要近期身份核验，请重新核验后重试"
    if (error.status === 400) return "设备名称或请求无效，请检查名称后重试"
  }
  return identityManagementError(error)
}
