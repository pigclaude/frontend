// 负责把账号指纹配置转换成 PigBrowser 启动参数，保留既有账号的自动种子算法。

import { createHash } from "node:crypto"
import {
  normalizeFingerprintSeed,
  type ClaudeFingerprintView,
  type FingerprintNoise,
  type FingerprintSpoofingCategory,
  type FingerprintWebrtcPolicy,
} from "@pigclaude/contracts/claude-account"

const maxSeed = 2_147_483_647
const brands = new Set(["Chrome", "Edge", "Opera", "Vivaldi"])
const platforms = new Set(["windows", "linux", "macos"])
const webrtcPolicies = new Set<FingerprintWebrtcPolicy>([
  "",
  "disable_non_proxied_udp",
  "default_public_interface_only",
  "default_public_and_private_interfaces",
])
const spoofingCategories = new Set<FingerprintSpoofingCategory>([
  "font",
  "audio",
  "canvas",
  "clientrects",
  "gpu",
])
const presetResolutions = new Set([
  "1920,1080",
  "1440,900",
  "1366,768",
  "2560,1440",
  "1280,800",
  "1600,900",
])
const langPattern = /^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8}){0,2}$/
const brandVersionPattern = /^\d+(?:\.\d+){0,4}$/
const platformVersionPattern = /^[A-Za-z0-9._-]+$/
const resolutionPattern = /^(\d{3,5}),(\d{3,5})$/

/** 宿主屏幕可用区域；由调用方注入，避免参数构建依赖 Electron。 */
export type ScreenSize = { width: number; height: number }

/** 构建启动参数的可选输入。保证不传屏幕尺寸时按 AntBrowser 的 1920x1080 兜底。 */
export type FingerprintArgsOptions = { screen?: ScreenSize }

/** 指纹校验结果。失败时带中文原因，成功时返回只含白名单字段的归一化配置。 */
export type FingerprintValidation =
  { ok: true; fingerprint: ClaudeFingerprintView } | { ok: false; message: string }

/**
 * 校验并归一化指纹。
 * 保证只返回模型内的白名单字段、空值保留为空、平台别名归一、mac 统一为 macos。
 */
export function validateFingerprint(value: ClaudeFingerprintView): FingerprintValidation {
  const seed = normalizeFingerprintSeed(value.seed)
  if (seed === null) {
    return { ok: false, message: "指纹种子必须是 0 到 18446744073709551615 的整数" }
  }

  const canvasNoise = normalizeNoise(value.canvasNoise)
  if (canvasNoise === null) {
    return { ok: false, message: "Canvas 噪声只能是空、0 或 1" }
  }
  const clientRectsNoise = normalizeNoise(value.clientRectsNoise)
  if (clientRectsNoise === null) {
    return { ok: false, message: "ClientRects 噪声只能是空、0 或 1" }
  }

  const brand = value.brand.trim()
  if (brand !== "" && !brands.has(brand)) {
    return { ok: false, message: "浏览器品牌仅支持 Chrome、Edge、Opera、Vivaldi" }
  }

  const brandVersion = optionalText(value.brandVersion)
  if (brandVersion !== "" && !brandVersionPattern.test(brandVersion)) {
    return { ok: false, message: "品牌版本必须是数字点分格式，例如 144.0.7559.132" }
  }

  const platform = normalizePlatform(value.platform)
  if (platform !== "" && !platforms.has(platform)) {
    return { ok: false, message: "平台仅支持 windows、linux、macos" }
  }

  const platformVersion = optionalText(value.platformVersion)
  if (platformVersion !== "" && !platformVersionPattern.test(platformVersion)) {
    return { ok: false, message: "系统版本只能包含字母、数字、点、横线和下划线" }
  }

  const lang = value.lang.trim()
  if (lang !== "" && !langPattern.test(lang)) {
    return { ok: false, message: "语言格式不正确，例如 zh-CN 或 en-US" }
  }

  const acceptLang = normalizeAcceptLang(value.acceptLang)
  if (acceptLang === null) {
    return { ok: false, message: "Accept-Language 必须是逗号分隔的语言列表，例如 zh-CN,zh" }
  }

  const timezone = value.timezone.trim()
  if (timezone !== "" && timezone.toLowerCase() !== "system" && !isTimeZone(timezone)) {
    return { ok: false, message: "时区不是当前系统可识别的 IANA 名称" }
  }

  const resolution = optionalText(value.resolution)
  const customResolution = optionalText(value.customResolution)
  if (!isValidResolution(resolution, customResolution)) {
    return { ok: false, message: "分辨率必须是预设值，或 custom 加宽高都不小于 200 的自定义值" }
  }

  const hardwareConcurrency = optionalText(value.hardwareConcurrency)
  if (hardwareConcurrency !== "" && !isIntegerInRange(hardwareConcurrency, 1, 128)) {
    return { ok: false, message: "CPU 核心数必须是 1 到 128 的整数" }
  }

  const webrtcPolicy = value.webrtcPolicy ?? ""
  if (!webrtcPolicies.has(webrtcPolicy)) {
    return { ok: false, message: "WebRTC 策略仅支持三个固定取值或留空" }
  }

  const disableSpoofing = normalizeSpoofing(value.disableSpoofing)
  if (disableSpoofing === null) {
    return { ok: false, message: "禁用伪装类别必须是字符串数组" }
  }

  const unknownArgs = normalizeUnknownArgs(value.unknownArgs)
  if (unknownArgs === null) {
    return { ok: false, message: "原始参数必须是字符串数组" }
  }

  return {
    ok: true,
    fingerprint: {
      seed,
      brand,
      platform,
      lang,
      timezone,
      canvasNoise,
      clientRectsNoise,
      brandVersion,
      platformVersion,
      acceptLang,
      resolution,
      customResolution,
      hardwareConcurrency,
      webrtcPolicy,
      disableSpoofing,
      colorDepth: optionalText(value.colorDepth),
      deviceMemory: optionalText(value.deviceMemory),
      touchPoints: optionalText(value.touchPoints),
      doNotTrack: optionalText(value.doNotTrack),
      mediaDevices: optionalText(value.mediaDevices),
      audioNoise: optionalText(value.audioNoise),
      fontList: optionalText(value.fontList),
      webglVendor: optionalText(value.webglVendor),
      webglRenderer: optionalText(value.webglRenderer),
      unknownArgs,
    },
  }
}

/**
 * 校验指纹；空种子时按账号 ID 生成 1..2147483647 的稳定整数。
 * 保证同一账号跨启动得到相同种子，且返回值已经通过完整校验。
 */
export function ensureFingerprint(
  value: ClaudeFingerprintView,
  accountId: string,
): FingerprintValidation {
  const seed = value.seed.trim() === "" ? seedFromAccountId(accountId) : value.seed
  return validateFingerprint({ ...value, seed })
}

/**
 * 生成 fingerprint-chromium 的指纹参数。
 * 保证输出顺序与 AntBrowser 1.8.0 的 B() 一致，并在种子为空时拒绝启动。
 */
export function buildFingerprintArgs(
  value: ClaudeFingerprintView,
  options: FingerprintArgsOptions = {},
): string[] {
  const validation = validateFingerprint(value)
  if (!validation.ok) throw new Error(validation.message)
  const fingerprint = validation.fingerprint
  if (fingerprint.seed === "") throw new Error("指纹种子必须在启动前生成")

  const args = [`--fingerprint=${fingerprint.seed}`]
  if (fingerprint.brand !== "") args.push(`--fingerprint-brand=${fingerprint.brand}`)
  if (fingerprint.brandVersion !== undefined && fingerprint.brandVersion !== "") {
    args.push(`--fingerprint-brand-version=${fingerprint.brandVersion}`)
  }
  if (fingerprint.platform !== "") {
    args.push(`--fingerprint-platform=${normalizePlatform(fingerprint.platform)}`)
  }
  if (fingerprint.platformVersion !== undefined && fingerprint.platformVersion !== "") {
    args.push(`--fingerprint-platform-version=${fingerprint.platformVersion}`)
  }
  if (fingerprint.lang !== "") {
    args.push(`--lang=${fingerprint.lang}`)
    args.push(`--accept-lang=${fingerprint.acceptLang || acceptLanguage(fingerprint.lang)}`)
  } else if (fingerprint.acceptLang !== undefined && fingerprint.acceptLang !== "") {
    args.push(`--accept-lang=${fingerprint.acceptLang}`)
  }
  if (fingerprint.timezone !== "") args.push(`--timezone=${resolveTimezone(fingerprint.timezone)}`)

  const resolution =
    fingerprint.resolution === "custom"
      ? (fingerprint.customResolution ?? "")
      : (fingerprint.resolution ?? "")
  args.push(`--window-size=${resolution === "" ? defaultWindowSize(options.screen) : resolution}`)

  if (fingerprint.hardwareConcurrency !== undefined && fingerprint.hardwareConcurrency !== "") {
    args.push(`--fingerprint-hardware-concurrency=${fingerprint.hardwareConcurrency}`)
  }
  if (fingerprint.webrtcPolicy === "disable_non_proxied_udp") {
    args.push("--disable-non-proxied-udp")
  } else if (fingerprint.webrtcPolicy !== undefined && fingerprint.webrtcPolicy !== "") {
    args.push(`--webrtc-ip-handling-policy=${fingerprint.webrtcPolicy}`)
  }

  args.push(...noiseArgs("--fingerprinting-canvas-image-data-noise", fingerprint.canvasNoise))
  args.push(...noiseArgs("--fingerprinting-client-rects-noise", fingerprint.clientRectsNoise))

  const disabled = fingerprint.disableSpoofing ?? []
  if (disabled.length > 0) args.push(`--disable-spoofing=${disabled.join(",")}`)
  args.push(...(fingerprint.unknownArgs ?? []))
  return args
}

/** 把 system 解析为系统 IANA 时区；解析失败回退 UTC。显式 IANA 名称原样返回。 */
export function resolveTimezone(timezone: string): string {
  const trimmed = timezone.trim()
  if (trimmed.toLowerCase() !== "system") return trimmed
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  } catch {
    return "UTC"
  }
}

/**
 * 按 AntBrowser 新建 profile 的规则计算默认窗口大小。
 * 保证宽 960..1440、高不小于 540，并用 16:9 约束在屏幕可用高度内；缺省屏幕按 1920x1080。
 */
export function defaultWindowSize(screen?: ScreenSize): string {
  const screenWidth = positiveNumber(screen?.width) || 1920
  const screenHeight = positiveNumber(screen?.height) || 1080
  const width = Math.round(clamp(screenWidth * 0.42, 960, 1440))
  const heightLimit = Math.max(540, Math.floor(screenHeight * 0.82))
  const height = Math.round(clamp((width * 9) / 16, 540, heightLimit))
  return `${width},${height}`
}

/** 由语言推导 Accept-Language。保证 zh-CN 变成 zh-CN,zh，单独语言原样返回。 */
export function acceptLanguage(lang: string): string {
  const trimmed = lang.trim()
  const separator = trimmed.search(/[-_]/)
  return separator > 0 ? `${trimmed},${trimmed.slice(0, separator)}` : trimmed
}

/** 把 mac/macOS 归一为 macos，其余平台转小写。保证与 AntBrowser 的归一化一致。 */
export function normalizePlatform(platform: string): string {
  const normalized = platform.trim().toLowerCase()
  return normalized === "mac" ? "macos" : normalized
}

function seedFromAccountId(accountId: string): string {
  const digest = createHash("sha256").update(accountId, "utf8").digest()
  return String((digest.readUInt32BE(0) % maxSeed) + 1)
}

function normalizeNoise(value: FingerprintNoise): FingerprintNoise | null {
  return value === "" || value === "0" || value === "1" ? value : null
}

function normalizeAcceptLang(value: string | undefined): string | null {
  const trimmed = optionalText(value)
  if (trimmed === "") return ""
  const items = trimmed
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "")
  return items.length > 0 && items.every((item) => langPattern.test(item)) ? items.join(",") : null
}

function normalizeSpoofing(
  value: FingerprintSpoofingCategory[] | undefined,
): FingerprintSpoofingCategory[] | null {
  if (value === undefined) return []
  if (!Array.isArray(value)) return null
  const result: FingerprintSpoofingCategory[] = []
  for (const item of value) {
    if (typeof item !== "string") continue
    const category = item.trim().toLowerCase()
    if (spoofingCategories.has(category as FingerprintSpoofingCategory)) {
      if (!result.includes(category as FingerprintSpoofingCategory)) {
        result.push(category as FingerprintSpoofingCategory)
      }
    }
  }
  return result
}

function normalizeUnknownArgs(value: string[] | undefined): string[] | null {
  if (value === undefined) return []
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) return null
  return [...value]
}

function isValidResolution(resolution: string, customResolution: string): boolean {
  if (resolution === "") return true
  if (resolution === "custom") return isWindowSize(customResolution)
  return presetResolutions.has(resolution)
}

function isWindowSize(value: string): boolean {
  const match = resolutionPattern.exec(value)
  if (match === null) return false
  return Number(match[1]) >= 200 && Number(match[2]) >= 200
}

function isIntegerInRange(value: string, min: number, max: number): boolean {
  if (!/^\d+$/.test(value)) return false
  const number = Number(value)
  return Number.isSafeInteger(number) && number >= min && number <= max
}

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: value })
    return true
  } catch {
    return false
  }
}

function noiseArgs(flag: string, value: FingerprintNoise): string[] {
  if (value === "1") return [flag]
  if (value === "0") return [`${flag}=0`]
  return []
}

function optionalText(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : ""
}

function positiveNumber(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
