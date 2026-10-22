// 负责支付设置的脱敏读取和即时命令，秘密不保存在 facade 状态中。
import { isSettingsAuditPage } from "@pigclaude/contracts/security-settings"
import type { HttpClient } from "../client"
import { createAdminSessionWriter } from "../admin/session"
import type { PayType } from "./types"
/** 支付设置公开视图只有密钥存在性。 */
export interface PaymentSettingsView {
  revision: string
  enabled: boolean
  gatewayUrl: string
  pid: string
  keyConfigured: boolean
  payTypes: PayType[]
  notifyBaseUrl: string
}
/** 保存采用字符串 CAS 版本，省略 key 保留原密钥。 */
export interface SavePaymentSettings {
  expectedRevision: string
  enabled: boolean
  gatewayUrl: string
  pid: string
  key?: string
  payTypes: PayType[]
  notifyBaseUrl: string
}
async function view(request: Promise<unknown>): Promise<PaymentSettingsView> {
  const value = await request
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("支付设置响应格式无效")
  const v = value as Record<string, unknown>
  const keys = [
    "revision",
    "enabled",
    "gatewayUrl",
    "pid",
    "keyConfigured",
    "payTypes",
    "notifyBaseUrl",
  ]
  if (
    Object.keys(v).length !== keys.length ||
    Object.keys(v).some((key) => !keys.includes(key)) ||
    typeof v.revision !== "string" ||
    !/^(0|[1-9][0-9]*)$/.test(v.revision) ||
    BigInt(v.revision) > 9223372036854775807n ||
    typeof v.enabled !== "boolean" ||
    typeof v.keyConfigured !== "boolean" ||
    typeof v.gatewayUrl !== "string" ||
    typeof v.pid !== "string" ||
    typeof v.notifyBaseUrl !== "string" ||
    !Array.isArray(v.payTypes) ||
    !v.payTypes.every((p) => p === "alipay" || p === "wxpay")
  )
    throw new Error("支付设置响应格式无效")
  return value as PaymentSettingsView
}
/** 创建独立支付设置 facade，仅返回验证后的脱敏响应。 */
export function createPaymentSettingsApi(client: HttpClient) {
  const path = "/admin/v1/settings/payment"
  const write = createAdminSessionWriter(client)
  return {
    /** 读取支付元数据，不读取安全设置。 */
    view: () => view(client.get<unknown>(path)),
    /** 空白密钥省略，非空密钥原样发送且不缓存。 */
    save: ({ key, ...input }: SavePaymentSettings, owner: () => boolean = () => true) =>
      view(
        write<unknown>("PUT", path, { ...input, ...(key?.trim() ? { key } : {}) }, "header", owner),
      ),
    /** 支付审计只允许脱敏白名单字段。 */
    audits: async (query: { cursor?: string; limit?: number } = {}) => {
      const value = await client.get<unknown>(`${path}/audits`, query)
      if (!isSettingsAuditPage(value)) throw new Error("支付审计响应格式无效")
      return value
    },
  }
}
/** 支付设置 facade 的结构类型。 */
export type PaymentSettingsApi = ReturnType<typeof createPaymentSettingsApi>
