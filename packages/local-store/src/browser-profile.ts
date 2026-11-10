// 定义可复用的浏览器实例配置，不把账号 Cookie 或浏览器数据路径存入共享配置。

import { normalizeFingerprint, type FingerprintConfig } from "./schema"

/** 一份稳定实例配置；代理凭据仍由代理池持有，记录不保存绝对浏览器路径。 */
export type BrowserProfileRecord = {
  schemaVersion: 1
  id: string
  name: string
  proxyId: string | null
  fingerprint: FingerprintConfig
  revision: number
  createdAt: string
  updatedAt: string
  legacyAccountId?: string
}

/** 读取本机配置，要求安全数据标识与明确版本；无法识别的记录留给存储层保留。 */
export function parseBrowserProfile(value: unknown): BrowserProfileRecord | null {
  if (!record(value)) return null
  if (
    value.schemaVersion !== 1 ||
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    (value.proxyId !== null && typeof value.proxyId !== "string") ||
    typeof value.revision !== "number" ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1 ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string" ||
    (value.legacyAccountId !== undefined && typeof value.legacyAccountId !== "string")
  )
    return null
  const fingerprint = normalizeFingerprint(value.fingerprint)
  if (!fingerprint) return null
  return {
    schemaVersion: 1,
    id: value.id,
    name: value.name,
    proxyId: value.proxyId,
    fingerprint,
    revision: value.revision,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    ...(value.legacyAccountId === undefined ? {} : { legacyAccountId: value.legacyAccountId }),
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
