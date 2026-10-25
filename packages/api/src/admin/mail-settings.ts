// 负责邮件设置的脱敏读取、保存、审计和测试发信，秘密不保存在 facade 状态中。
import { isSettingsAuditPage } from "@pigclaude/contracts/security-settings"
import type { HttpClient } from "../client"
import { createAdminSessionWriter } from "./session"
/** 邮件设置公开视图只包含授权码存在性，永不包含明文或密文。 */
export interface MailSettingsView {
  revision: string
  enabled: boolean
  host: string
  port: number
  encryption: "ssl" | "starttls"
  username: string
  passwordConfigured: boolean
  fromName: string
  fromAddress: string
}
/** 保存采用字符串 CAS 版本，省略 password 保留原授权码。 */
export interface SaveMailSettings {
  expectedRevision: string
  enabled: boolean
  host: string
  port: number
  encryption: "ssl" | "starttls"
  username: string
  password?: string
  fromName: string
  fromAddress: string
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
async function view(request: Promise<unknown>): Promise<MailSettingsView> {
  const value = await request
  if (!record(value)) throw new Error("邮件设置响应格式无效")
  const keys = [
    "revision",
    "enabled",
    "host",
    "port",
    "encryption",
    "username",
    "passwordConfigured",
    "fromName",
    "fromAddress",
  ]
  if (
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !keys.includes(key)) ||
    typeof value.revision !== "string" ||
    !/^(0|[1-9][0-9]*)$/.test(value.revision) ||
    BigInt(value.revision) > 9223372036854775807n ||
    typeof value.enabled !== "boolean" ||
    typeof value.host !== "string" ||
    typeof value.port !== "number" ||
    !Number.isInteger(value.port) ||
    value.port < 0 ||
    value.port > 65535 ||
    (value.encryption !== "ssl" && value.encryption !== "starttls") ||
    typeof value.username !== "string" ||
    typeof value.passwordConfigured !== "boolean" ||
    typeof value.fromName !== "string" ||
    typeof value.fromAddress !== "string"
  )
    throw new Error("邮件设置响应格式无效")
  return value as unknown as MailSettingsView
}
/** 创建独立邮件设置 facade，仅返回验证后的脱敏响应。 */
export function createMailSettingsApi(client: HttpClient) {
  const path = "/admin/v1/settings/mail"
  const write = createAdminSessionWriter(client)
  return {
    /** 读取邮件元数据，不读取授权码。 */
    view: () => view(client.get<unknown>(path)),
    /** 空白授权码省略，非空授权码原样发送且不缓存。 */
    save: ({ password, ...input }: SaveMailSettings, owner: () => boolean = () => true) =>
      view(
        write<unknown>(
          "PUT",
          path,
          { ...input, ...(password?.trim() ? { password } : {}) },
          "header",
          owner,
        ),
      ),
    /** 邮件审计只允许脱敏白名单字段。 */
    audits: async (query: { cursor?: string; limit?: number } = {}) => {
      const value = await client.get<unknown>(`${path}/audits`, query)
      if (!isSettingsAuditPage(value)) throw new Error("邮件审计响应格式无效")
      return value
    },
    /** 测试发信只接受收件地址，失败原因由 ApiError.metadata 提供。 */
    sendTest: async (to: string, owner: () => boolean = () => true) => {
      const value = await write<unknown>("POST", `${path}/test`, { to }, "header", owner)
      if (!record(value) || value.type !== "sent") throw new Error("测试发信响应格式无效")
    },
  }
}
/** 邮件设置 facade 的结构类型。 */
export type MailSettingsApi = ReturnType<typeof createMailSettingsApi>
