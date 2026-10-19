// 负责设置管理 HTTP 命令与脱敏验证，不保留秘密请求参数。
import {
  isSecuritySettingsView,
  isSettingsAuditPage,
  type SaveTurnstileDraft,
  type ActivateTurnstileDraft,
  type DisableTurnstile,
} from "@pigclaude/contracts/security-settings"
import type { HttpClient } from "../client"
async function view(request: Promise<unknown>) {
  const value = await request
  if (!isSecuritySettingsView(value)) throw new Error("设置响应格式无效")
  return value
}
/** 创建只返回验证过的公开设置数据的 facade。 */
export function createSecuritySettingsApi(client: HttpClient) {
  const path = "/admin/v1/settings/turnstile"
  return {
    /** 读取脱敏配置。 */
    get: () => view(client.get<unknown>(path)),
    /** 空秘密不发送，避免覆盖已保存材料。 */
    saveDraft: ({ secretKey, ...body }: SaveTurnstileDraft) =>
      view(client.put<unknown>(`${path}/draft`, { ...body, ...(secretKey ? { secretKey } : {}) })),
    /** 只启用与 proof 对应的同版草稿。 */
    activate: (body: ActivateTurnstileDraft) =>
      view(client.post<unknown>(`${path}/activate`, body)),
    /** 独立确认关闭。 */
    disable: (body: DisableTurnstile) => view(client.post<unknown>(`${path}/disable`, body)),
    /** 读取已验证的脱敏审计分页。 */
    audits: async (query: { cursor?: string; limit?: number } = {}) => {
      const value = await client.get<unknown>(`${path}/audits`, query)
      if (!isSettingsAuditPage(value)) throw new Error("设置审计响应格式无效")
      return value
    },
  }
}
