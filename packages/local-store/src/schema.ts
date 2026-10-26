// 负责本机账号和代理记录的类型、旧版本兼容读取与运行时校验。

import { isClaudeCredential, type ClaudeCredential } from "./credential"

/** 噪声开关三态：空字符串表示启动时不输出，0 表示关闭，1 表示开启。 */
export type FingerprintNoise = "" | "0" | "1"

/** 可单独禁用的伪装类别，对应 AntBrowser 的 --disable-spoofing。 */
export type FingerprintSpoofingCategory = "font" | "audio" | "canvas" | "clientrects" | "gpu"

/** WebRTC 策略；空字符串表示不输出该 flag。 */
export type FingerprintWebrtcPolicy =
  | ""
  | "disable_non_proxied_udp"
  | "default_public_interface_only"
  | "default_public_and_private_interfaces"

/**
 * 一个账号的指纹配置。7 个既有字段必填，其余字段可选。
 * 保证读取时由 normalizeFingerprint 补全默认值并丢弃未知键。
 */
export type FingerprintConfig = {
  seed: string
  brand: string
  platform: string
  lang: string
  timezone: string
  canvasNoise: FingerprintNoise
  clientRectsNoise: FingerprintNoise
  brandVersion?: string
  platformVersion?: string
  acceptLang?: string
  resolution?: string
  customResolution?: string
  hardwareConcurrency?: string
  webrtcPolicy?: FingerprintWebrtcPolicy
  disableSpoofing?: FingerprintSpoofingCategory[]
  colorDepth?: string
  deviceMemory?: string
  touchPoints?: string
  doNotTrack?: string
  mediaDevices?: string
  audioNoise?: string
  fontList?: string
  webglVendor?: string
  webglRenderer?: string
  unknownArgs?: string[]
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

/** 本机一条账号记录。保证凭据可空、需要重新授权时有明确标记；proxyId 为 null 表示不使用代理并走系统网络。 */
export type AccountRecord = {
  schemaVersion: 3
  id: string
  displayName: string
  enabled: boolean
  credential: ClaudeCredential | null
  needsReauth: boolean
  proxyId: string | null
  fingerprint: FingerprintConfig
  browserProfileDir: string
  exhaustedUntil: string | null
  createdAt: string
  updatedAt: string
}

/** v3 记录的读取形态。proxyId 可能缺失、为 null 或空字符串，解析时统一归一为 null。 */
type StoredAccountV3 = Omit<AccountRecord, "proxyId" | "fingerprint"> & {
  proxyId?: string | null
  fingerprint: unknown
}

/** 旧版 v1 账号记录。旧字符串凭据不迁移，只标记为需要重新授权。 */
type LegacyAccountRecordV1 = {
  id: string
  enabled: boolean
  credential: string
  proxyId: string
  fingerprint: unknown
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
  fingerprint: unknown
  exhaustedUntil: string | null
  createdAt: string
  updatedAt: string
}

/** 旧版代理记录。读取时补 name 和 lastTest。 */
type LegacyIpProxy = {
  id: string
  url: string
}

/**
 * 解析一条账号记录。保证 v1/v2/v3 的指纹都经过归一化；指纹损坏但账号字段完整时回退到默认指纹；
 * v3 的 proxyId 归一为 null；账号结构本身无法识别时返回 null。
 */
export function parseAccountRecord(value: unknown): AccountRecord | null {
  if (isV3Account(value)) return normalizeV3(value)
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

/**
 * 把存储中的任意指纹值归一化为当前模型。
 * 保证旧布尔噪声转成三态、缺失的可选字段补空值、未知键被丢弃、非法可选值被过滤；
 * 品牌/平台/语言/时区不是字符串时返回 null。种子缺失时使用 fallbackSeed。
 */
export function normalizeFingerprint(value: unknown, fallbackSeed = ""): FingerprintConfig | null {
  if (!isRecord(value)) return null
  if (
    typeof value.brand !== "string" ||
    typeof value.platform !== "string" ||
    typeof value.lang !== "string" ||
    typeof value.timezone !== "string"
  ) {
    return null
  }
  return {
    ...defaultFingerprint(typeof value.seed === "string" ? value.seed : fallbackSeed),
    brand: value.brand,
    platform: value.platform,
    lang: value.lang,
    timezone: value.timezone,
    canvasNoise: normalizeNoise(value.canvasNoise),
    clientRectsNoise: normalizeNoise(value.clientRectsNoise),
    brandVersion: optionalString(value.brandVersion),
    platformVersion: optionalString(value.platformVersion),
    acceptLang: optionalString(value.acceptLang),
    resolution: optionalString(value.resolution),
    customResolution: optionalString(value.customResolution),
    hardwareConcurrency: optionalString(value.hardwareConcurrency),
    webrtcPolicy: isWebrtcPolicy(value.webrtcPolicy) ? value.webrtcPolicy : "",
    disableSpoofing: normalizeSpoofing(value.disableSpoofing),
    colorDepth: optionalString(value.colorDepth),
    deviceMemory: optionalString(value.deviceMemory),
    touchPoints: optionalString(value.touchPoints),
    doNotTrack: optionalString(value.doNotTrack),
    mediaDevices: optionalString(value.mediaDevices),
    audioNoise: optionalString(value.audioNoise),
    fontList: optionalString(value.fontList),
    webglVendor: optionalString(value.webglVendor),
    webglRenderer: optionalString(value.webglRenderer),
    unknownArgs: normalizeUnknownArgs(value.unknownArgs),
  }
}

// 指纹损坏或缺失时的默认值；与 contracts 的 defaultClaudeFingerprint 保持一致。
function defaultFingerprint(seed = ""): FingerprintConfig {
  return {
    seed,
    brand: "Chrome",
    platform: "macos",
    lang: "",
    timezone: "",
    canvasNoise: "",
    clientRectsNoise: "",
    brandVersion: "",
    platformVersion: "",
    acceptLang: "",
    resolution: "",
    customResolution: "",
    hardwareConcurrency: "",
    webrtcPolicy: "",
    disableSpoofing: [],
    colorDepth: "",
    deviceMemory: "",
    touchPoints: "",
    doNotTrack: "",
    mediaDevices: "",
    audioNoise: "",
    fontList: "",
    webglVendor: "",
    webglRenderer: "",
    unknownArgs: [],
  }
}

function normalizeNoise(value: unknown): FingerprintNoise {
  if (value === true || value === "1") return "1"
  if (value === false || value === "0") return "0"
  return ""
}

function optionalString(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function isWebrtcPolicy(value: unknown): value is FingerprintWebrtcPolicy {
  return (
    value === "" ||
    value === "disable_non_proxied_udp" ||
    value === "default_public_interface_only" ||
    value === "default_public_and_private_interfaces"
  )
}

function isSpoofingCategory(value: unknown): value is FingerprintSpoofingCategory {
  return (
    value === "font" ||
    value === "audio" ||
    value === "canvas" ||
    value === "clientrects" ||
    value === "gpu"
  )
}

// 只保留五个已知类别并去重，顺序沿用存储值。
function normalizeSpoofing(value: unknown): FingerprintSpoofingCategory[] {
  if (!Array.isArray(value)) return []
  const categories: FingerprintSpoofingCategory[] = []
  for (const item of value) {
    if (isSpoofingCategory(item) && !categories.includes(item)) categories.push(item)
  }
  return categories
}

function normalizeUnknownArgs(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string")
}

function isV3Account(value: unknown): value is StoredAccountV3 {
  if (!isRecord(value)) return false
  if (value.schemaVersion !== 3) return false
  return (
    typeof value.id === "string" &&
    typeof value.displayName === "string" &&
    typeof value.enabled === "boolean" &&
    (value.credential === null || isClaudeCredential(value.credential)) &&
    typeof value.needsReauth === "boolean" &&
    (value.proxyId === undefined || value.proxyId === null || typeof value.proxyId === "string") &&
    typeof value.browserProfileDir === "string" &&
    (value.exhaustedUntil === null || typeof value.exhaustedUntil === "string") &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  )
}

/** 保证指纹结构损坏但账号字段完整的记录回退到默认指纹，而不是让整条记录不可读。 */
function normalizeV3(value: StoredAccountV3): AccountRecord {
  const proxyId = value.proxyId
  return {
    ...value,
    fingerprint: normalizeFingerprint(value.fingerprint, value.id) ?? defaultFingerprint(),
    proxyId: proxyId === undefined || proxyId === null || proxyId === "" ? null : proxyId,
  }
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
    fingerprint: normalizeFingerprint(value.fingerprint, value.id) ?? defaultFingerprint(),
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
    fingerprint: normalizeFingerprint(value.fingerprint, value.id) ?? defaultFingerprint(),
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
