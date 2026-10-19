// 负责定义设置命令与严格脱敏响应边界，阻止未知秘密字段进入缓存。
/** Turnstile 设置的公开元数据；秘密仅返回是否配置。 */
export interface TurnstileSettingsSummary {
  revision: string
  enabled: boolean
  mode: string
  siteKey: string | null
  hostnames: string[]
  secretConfigured: boolean
  updatedAt: string
  updatedBy: string
}
/** 同一次读取的生效版、草稿和全局版本。 */
export interface SecuritySettingsView {
  revision: string
  active: TurnstileSettingsSummary
  draft: TurnstileSettingsSummary | null
}
/** 保存草稿，省略 secretKey 保留已有秘密。 */
export interface SaveTurnstileDraft {
  expectedRevision: string
  enabled: boolean
  siteKey: string | null
  hostnames: string[]
  secretKey?: string
}
/** 核验当前草稿的单次 proof 并进行 CAS。 */
export interface ActivateTurnstileDraft {
  expectedRevision: string
  captchaToken: string
}
/** 显式确认关闭验证，保留可复用材料。 */
export interface DisableTurnstile {
  expectedRevision: string
  confirmed: true
}
/** 审计只包含操作者、字段名和版本。 */
export interface SettingsAuditEvent {
  revision: string
  actor: string
  type: string
  time: string
  changedFields: string[]
}
/** 审计分页以版本作为游标。 */
export interface SettingsAuditPage {
  items: SettingsAuditEvent[]
  nextCursor: string | null
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  return (
    Object.keys(value).length === allowed.length &&
    Object.keys(value).every((key) => allowed.includes(key))
  )
}
function revision(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^(0|[1-9][0-9]*)$/.test(value) &&
    BigInt(value) <= 9223372036854775807n
  )
}
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}
function summary(value: unknown): value is TurnstileSettingsSummary {
  return (
    record(value) &&
    keys(value, [
      "revision",
      "enabled",
      "mode",
      "siteKey",
      "hostnames",
      "secretConfigured",
      "updatedAt",
      "updatedBy",
    ]) &&
    revision(value.revision) &&
    typeof value.enabled === "boolean" &&
    typeof value.mode === "string" &&
    (value.siteKey === null || typeof value.siteKey === "string") &&
    strings(value.hostnames) &&
    typeof value.secretConfigured === "boolean" &&
    typeof value.updatedAt === "string" &&
    Number.isFinite(Date.parse(value.updatedAt)) &&
    typeof value.updatedBy === "string"
  )
}
/** 仅接受完整白名单字段，未知明文或密文字段均拒绝。 */
export function isSecuritySettingsView(value: unknown): value is SecuritySettingsView {
  return (
    record(value) &&
    keys(value, ["revision", "active", "draft"]) &&
    revision(value.revision) &&
    summary(value.active) &&
    (value.draft === null || summary(value.draft))
  )
}
/** 验证完整审计白名单，禁止未验证的数据进入查询缓存。 */
export function isSettingsAuditPage(value: unknown): value is SettingsAuditPage {
  return (
    record(value) &&
    keys(value, ["items", "nextCursor"]) &&
    (value.nextCursor === null || revision(value.nextCursor)) &&
    Array.isArray(value.items) &&
    value.items.every(
      (item: unknown) =>
        record(item) &&
        keys(item, ["revision", "actor", "type", "time", "changedFields"]) &&
        revision(item.revision) &&
        typeof item.actor === "string" &&
        typeof item.type === "string" &&
        typeof item.time === "string" &&
        Number.isFinite(Date.parse(item.time)) &&
        strings(item.changedFields),
    )
  )
}
