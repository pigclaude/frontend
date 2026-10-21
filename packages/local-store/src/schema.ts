// 负责本机账号和代理记录的类型、旧版本兼容读取与运行时校验。

import { isClaudeCredential, type ClaudeCredential } from "./credential"

/** 一个账号的指纹配置。保证种子、品牌、平台、语言、时区、画布噪声和 client rects 噪声一起保存。 */
export type FingerprintConfig = {
  seed: string
  brand: string
  platform: string
  lang: string
  timezone: string
  canvasNoise: boolean
  clientRectsNoise: boolean
}

/** 一条代理最近一次测试的结果。保证不含代理密码。 */
export type ProxyTestResult = {
  ok: boolean
  ip: string | null
  latencyMs: number
  testedAt: string
}

/** 代理池里的一条 IP 代理。保证 url 只在本机和主进程使用。 */
export type IpProxy = {
  schemaVersion: 1
  id: string
  name: string
  url: string
  lastTest: ProxyTestResult | null
}

/** 本机一条账号记录。保证凭据可空、需要重新授权时有明确标记，并绑定一条代理和一份指纹。 */
export type AccountRecord = {
  schemaVersion: 3
  id: string
  displayName: string
  enabled: boolean
  credential: ClaudeCredential | null
  needsReauth: boolean
  proxyId: string
  fingerprint: FingerprintConfig
  browserProfileDir: string
  exhaustedUntil: string | null
  createdAt: string
  updatedAt: string
}

/** 旧版 v1 账号记录。旧字符串凭据不迁移，只标记为需要重新授权。 */
type LegacyAccountRecordV1 = {
  id: string
  enabled: boolean
  credential: string
  proxyId: string
  fingerprint: FingerprintConfig
  exhaustedUntil: string | null
}

/** 旧版 v2 账号记录。仍然包含 AntBrowser 实例字段，读取时迁移为 v3。 */
type LegacyAccountRecordV2 = {
  id: string
  displayName: string
  enabled: boolean
  credential: ClaudeCredential | null
  needsReauth: boolean
  proxyId: string
  fingerprint: FingerprintConfig
  exhaustedUntil: string | null
  createdAt: string
  updatedAt: string
}

/** 旧版代理记录。读取时补 name 和 lastTest。 */
type LegacyIpProxy = {
  id: string
  url: string
}

/** 解析一条账号记录。保证 v1/v2 旧记录迁移为 v3，无法识别的记录返回 null。 */
export function parseAccountRecord(value: unknown): AccountRecord | null {
  if (isV3Account(value)) return value
  if (isV2Account(value)) return migrateV2(value)
  if (isV1Account(value)) return migrateV1(value)
  return null
}

/** 解析一条代理记录。保证旧记录补 name 和 lastTest，无法识别的记录返回 null。 */
export function parseProxy(value: unknown): IpProxy | null {
  if (isV1Proxy(value)) return value
  if (isLegacyProxy(value)) {
    return {
      schemaVersion: 1,
      id: value.id,
      name: value.id,
      url: value.url,
      lastTest: null,
    }
  }
  return null
}

/** 保证指纹字段类型完整；种子范围和枚举值由账号服务在写入前校验。 */
export function isFingerprint(value: unknown): value is FingerprintConfig {
  if (!isRecord(value)) return false
  return (
    typeof value.seed === "string" &&
    typeof value.brand === "string" &&
    typeof value.platform === "string" &&
    typeof value.lang === "string" &&
    typeof value.timezone === "string" &&
    typeof value.canvasNoise === "boolean" &&
    typeof value.clientRectsNoise === "boolean"
  )
}

function isV3Account(value: unknown): value is AccountRecord {
  if (!isRecord(value)) return false
  if (value.schemaVersion !== 3) return false
  return (
    typeof value.id === "string" &&
    typeof value.displayName === "string" &&
    typeof value.enabled === "boolean" &&
    (value.credential === null || isClaudeCredential(value.credential)) &&
    typeof value.needsReauth === "boolean" &&
    typeof value.proxyId === "string" &&
    isFingerprint(value.fingerprint) &&
    typeof value.browserProfileDir === "string" &&
    (value.exhaustedUntil === null || typeof value.exhaustedUntil === "string") &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  )
}

function isV2Account(value: unknown): value is LegacyAccountRecordV2 {
  if (!isRecord(value)) return false
  if (value.schemaVersion !== 2) return false
  return (
    typeof value.id === "string" &&
    typeof value.displayName === "string" &&
    typeof value.enabled === "boolean" &&
    (value.credential === null || isClaudeCredential(value.credential)) &&
    typeof value.needsReauth === "boolean" &&
    typeof value.proxyId === "string" &&
    isFingerprint(value.fingerprint) &&
    (value.exhaustedUntil === null || typeof value.exhaustedUntil === "string") &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  )
}

function isV1Account(value: unknown): value is LegacyAccountRecordV1 {
  if (!isRecord(value)) return false
  const schemaVersionValid = value.schemaVersion === undefined || value.schemaVersion === 1
  return (
    schemaVersionValid &&
    typeof value.id === "string" &&
    typeof value.enabled === "boolean" &&
    typeof value.credential === "string" &&
    typeof value.proxyId === "string" &&
    isFingerprint(value.fingerprint) &&
    (value.exhaustedUntil === null || typeof value.exhaustedUntil === "string")
  )
}

function migrateV2(value: LegacyAccountRecordV2): AccountRecord {
  return {
    schemaVersion: 3,
    id: value.id,
    displayName: value.displayName,
    enabled: value.enabled,
    credential: value.credential,
    needsReauth: value.needsReauth,
    proxyId: value.proxyId,
    fingerprint: value.fingerprint,
    browserProfileDir: "",
    exhaustedUntil: value.exhaustedUntil,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  }
}

function migrateV1(value: LegacyAccountRecordV1): AccountRecord {
  return {
    schemaVersion: 3,
    id: value.id,
    displayName: value.id,
    enabled: value.enabled,
    credential: null,
    needsReauth: true,
    proxyId: value.proxyId,
    fingerprint: value.fingerprint,
    browserProfileDir: "",
    exhaustedUntil: value.exhaustedUntil,
    createdAt: "",
    updatedAt: "",
  }
}

function isV1Proxy(value: unknown): value is IpProxy {
  if (!isRecord(value)) return false
  if (value.schemaVersion !== 1) return false
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.url === "string" &&
    (value.lastTest === null || isProxyTestResult(value.lastTest))
  )
}

function isLegacyProxy(value: unknown): value is LegacyIpProxy {
  if (!isRecord(value)) return false
  return typeof value.id === "string" && typeof value.url === "string"
}

function isProxyTestResult(value: unknown): value is ProxyTestResult {
  if (!isRecord(value)) return false
  return (
    typeof value.ok === "boolean" &&
    (value.ip === null || typeof value.ip === "string") &&
    typeof value.latencyMs === "number" &&
    Number.isFinite(value.latencyMs) &&
    typeof value.testedAt === "string"
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
