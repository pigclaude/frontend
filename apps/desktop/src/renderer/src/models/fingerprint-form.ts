// 负责指纹表单的默认值、归一化、前端轻量校验、原始参数解析和详情摘要。
// 字段元数据在 fingerprint-fields.ts，预设画像在 fingerprint-presets.ts，两者统一从这里导出。

import {
  defaultClaudeFingerprint,
  type ClaudeFingerprintView,
  type FingerprintNoise,
  type FingerprintSpoofingCategory,
  type FingerprintWebrtcPolicy,
} from "@pigclaude/contracts/claude-account"
import {
  fingerprintBrandOptions,
  fingerprintLegacyFields,
  fingerprintResolutionPresets,
  fingerprintSpoofingCategories,
  fingerprintWebrtcOptions,
  type FingerprintFieldKey,
  type FingerprintGroupId,
} from "./fingerprint-fields"

export * from "./fingerprint-fields"
export * from "./fingerprint-presets"

/** 字段级校验错误；没有错误的字段不出现。 */
export type FingerprintFormErrors = Partial<Record<FingerprintFieldKey, string>>

/** 详情页摘要的一行。block 为 true 时值换行显示，适合原始参数。 */
export type FingerprintSummaryRow = { label: string; value: string; block?: boolean }

/** 详情页摘要的一个分组。note 用于标注旧字段不是独立运行参数。 */
export type FingerprintSummaryGroup = {
  id: FingerprintGroupId
  title: string
  rows: FingerprintSummaryRow[]
  note?: string
}

/** 默认指纹表单；直接使用契约里的 AntBrowser 新 profile 默认值。 */
export function defaultFingerprintForm(): ClaudeFingerprintView {
  return defaultClaudeFingerprint()
}

/**
 * 归一化任意指纹草稿。
 * 保证返回完整 25 字段对象、文本去空白、平台别名归一、伪装类别去重并补齐默认值。
 */
export function normalizeFingerprintForm(
  value: Partial<ClaudeFingerprintView> | null | undefined,
): ClaudeFingerprintView {
  const merged = { ...defaultClaudeFingerprint(), ...(value ?? {}) }
  return {
    seed: text(merged.seed),
    brand: text(merged.brand),
    platform: normalizePlatform(merged.platform),
    lang: text(merged.lang),
    timezone: text(merged.timezone),
    canvasNoise: normalizeNoise(merged.canvasNoise),
    clientRectsNoise: normalizeNoise(merged.clientRectsNoise),
    brandVersion: text(merged.brandVersion),
    platformVersion: text(merged.platformVersion),
    acceptLang: normalizeAcceptLang(merged.acceptLang),
    resolution: text(merged.resolution),
    customResolution: text(merged.customResolution),
    hardwareConcurrency: text(merged.hardwareConcurrency),
    webrtcPolicy: normalizeWebrtc(merged.webrtcPolicy),
    disableSpoofing: normalizeSpoofing(merged.disableSpoofing),
    colorDepth: text(merged.colorDepth),
    deviceMemory: text(merged.deviceMemory),
    touchPoints: text(merged.touchPoints),
    doNotTrack: text(merged.doNotTrack),
    mediaDevices: text(merged.mediaDevices),
    audioNoise: text(merged.audioNoise),
    fontList: text(merged.fontList),
    webglVendor: text(merged.webglVendor),
    webglRenderer: text(merged.webglRenderer),
    unknownArgs: normalizeArgs(merged.unknownArgs),
  }
}

/**
 * 校验指纹草稿并返回中文字段级错误。
 * 规则与主进程的 AntBrowser 校验一致，但只用于前端提前提示；主进程仍会再校验一次。
 */
export function validateFingerprintForm(value: ClaudeFingerprintView): FingerprintFormErrors {
  const errors: FingerprintFormErrors = {}
  const seed = value.seed.trim()
  if (seed !== "" && !isIntegerInRange(seed, 1, 2_147_483_647)) {
    errors.seed = "指纹种子必须是 1 到 2147483647 的整数"
  }

  const brand = value.brand.trim()
  if (brand !== "" && !fingerprintBrandOptions.some((option) => option.value === brand)) {
    errors.brand = "浏览器品牌仅支持 Chrome、Edge、Opera、Vivaldi"
  }
  const brandVersion = text(value.brandVersion)
  if (brandVersion !== "" && !/^\d+(?:\.\d+){0,4}$/.test(brandVersion)) {
    errors.brandVersion = "品牌版本必须是数字点分格式，例如 144.0.7559.132"
  }

  const platform = normalizePlatform(value.platform)
  if (platform !== "" && !["windows", "linux", "macos"].includes(platform)) {
    errors.platform = "平台仅支持 windows、linux、macos"
  }
  const platformVersion = text(value.platformVersion)
  if (platformVersion !== "" && !/^[A-Za-z0-9._-]+$/.test(platformVersion)) {
    errors.platformVersion = "系统版本只能包含字母、数字、点、横线和下划线"
  }

  const lang = value.lang.trim()
  if (lang !== "" && !langPattern.test(lang)) {
    errors.lang = "语言格式不正确，例如 zh-CN 或 en-US"
  }
  const acceptLang = text(value.acceptLang)
  if (acceptLang !== "" && !isValidAcceptLang(acceptLang)) {
    errors.acceptLang = "Accept-Language 必须是逗号分隔的语言列表，例如 zh-CN,zh"
  }

  const timezone = value.timezone.trim()
  if (timezone !== "" && timezone.toLowerCase() !== "system" && !isTimeZone(timezone)) {
    errors.timezone = "时区不是当前系统可识别的 IANA 名称"
  }

  const resolution = text(value.resolution)
  if (resolution !== "") {
    if (resolution === "custom") {
      if (!isWindowSize(text(value.customResolution))) {
        errors.customResolution = "自定义分辨率必须是宽,高，宽高都不小于 200"
      }
    } else if (!(fingerprintResolutionPresets as readonly string[]).includes(resolution)) {
      errors.resolution = "分辨率必须是预设值，或选择自定义后填写宽高"
    }
  }

  const hardwareConcurrency = text(value.hardwareConcurrency)
  if (hardwareConcurrency !== "" && !isIntegerInRange(hardwareConcurrency, 1, 128)) {
    errors.hardwareConcurrency = "CPU 核心数必须是 1 到 128 的整数"
  }

  const webrtcPolicy = value.webrtcPolicy ?? ""
  if (!fingerprintWebrtcOptions.some((option) => option.value === webrtcPolicy)) {
    errors.webrtcPolicy = "WebRTC 策略仅支持三个固定取值或留空"
  }

  if (!isNoise(value.canvasNoise)) errors.canvasNoise = "Canvas 噪声只能是空、0 或 1"
  if (!isNoise(value.clientRectsNoise)) {
    errors.clientRectsNoise = "ClientRects 噪声只能是空、0 或 1"
  }

  const disabled = value.disableSpoofing
  if (disabled !== undefined && (!Array.isArray(disabled) || !disabled.every(isSpoofingCategory))) {
    errors.disableSpoofing = "禁用伪装类别必须来自字体、音频、Canvas、ClientRects、GPU"
  }

  const args = value.unknownArgs
  if (args !== undefined && (!Array.isArray(args) || !args.every(isString))) {
    errors.unknownArgs = "原始参数必须是字符串数组"
  }
  return errors
}

/** 是否有任何字段级错误。 */
export function hasFingerprintFormErrors(errors: FingerprintFormErrors): boolean {
  return Object.keys(errors).length > 0
}

/** 表单提交结果；失败时带字段级错误，成功时带归一化后的完整指纹。 */
export type FingerprintSubmitResult =
  { ok: true; fingerprint: ClaudeFingerprintView } | { ok: false; errors: FingerprintFormErrors }

/** 归一化 → 校验 → 提交的统一入口；指纹步骤和编辑弹层共用，避免两套提交逻辑漂移。 */
export function prepareFingerprintSubmission(
  value: ClaudeFingerprintView,
): FingerprintSubmitResult {
  const fingerprint = normalizeFingerprintForm(value)
  const errors = validateFingerprintForm(fingerprint)
  return hasFingerprintFormErrors(errors) ? { ok: false, errors } : { ok: true, fingerprint }
}

/** 把 textarea 文本拆成原始参数行；保留空行，便于继续输入。 */
export function splitUnknownArgs(text: string): string[] {
  return text.split(/\r?\n/)
}

/** 把原始参数数组格式化成每行一个参数。 */
export function formatUnknownArgs(args: string[] | undefined): string {
  return (args ?? []).join("\n")
}

/** 浏览器与平台的一行画像，用于授权向导的确认步骤。 */
export function fingerprintHeadline(value: ClaudeFingerprintView): string {
  const normalized = normalizeFingerprintForm(value)
  const brand = `${normalized.brand || "Chrome"}${suffix(normalized.brandVersion)}`
  const platform = `${platformLabel(normalized.platform)}${suffix(normalized.platformVersion)}`
  return `${brand} · ${platform}`
}

/** 语言与时区的一行画像，用于授权向导的确认步骤。 */
export function fingerprintLocaleLine(value: ClaudeFingerprintView): string {
  const normalized = normalizeFingerprintForm(value)
  return `${normalized.lang || "跟随系统语言"} · ${normalized.timezone || "系统时区"}`
}

/**
 * 生成详情页摘要。
 * 保证按身份、设备、兼容、高级四组展示；空值显示为跟随默认，而不是空字符串。
 */
export function fingerprintSummaryGroups(
  fingerprint: ClaudeFingerprintView | undefined,
): FingerprintSummaryGroup[] {
  const value = normalizeFingerprintForm(fingerprint)
  const legacyRows = advancedLegacyRows(value)
  return [
    {
      id: "identity",
      title: "身份与定位",
      rows: [
        { label: "指纹种子", value: value.seed || "按账号 ID 生成" },
        {
          label: "浏览器",
          value: `${value.brand || "Chrome"}${suffix(value.brandVersion) || "（跟随默认版本）"}`,
        },
        {
          label: "平台",
          value: `${platformLabel(value.platform)}${suffix(value.platformVersion)}`,
        },
        { label: "语言", value: value.lang || "跟随系统语言" },
        { label: "Accept-Language", value: value.acceptLang || "按语言推导" },
        { label: "时区", value: value.timezone || "系统时区" },
      ],
    },
    {
      id: "device",
      title: "设备与网络",
      rows: [
        { label: "窗口大小", value: resolutionLabel(value) },
        { label: "CPU 核心数", value: value.hardwareConcurrency || "跟随默认" },
        { label: "WebRTC", value: webrtcLabel(value.webrtcPolicy ?? "") },
      ],
    },
    {
      id: "compat",
      title: "兼容伪装",
      rows: [
        { label: "Canvas 噪声", value: noiseLabel(value.canvasNoise) },
        { label: "ClientRects 噪声", value: noiseLabel(value.clientRectsNoise) },
        { label: "禁用伪装", value: spoofingLabel(value.disableSpoofing) },
      ],
    },
    {
      id: "advanced",
      title: "高级原始参数",
      rows: [
        ...legacyRows,
        { label: "原始参数", value: value.unknownArgs?.join(" ") || "无", block: true },
      ],
      ...(legacyRows.length === 0
        ? {}
        : { note: "旧字段只保存和诊断，AntBrowser 1.8.0 不作为独立运行参数。" }),
    },
  ]
}

function advancedLegacyRows(value: ClaudeFingerprintView): FingerprintSummaryRow[] {
  return fingerprintLegacyFields.flatMap(({ key, label }) => {
    const raw = value[key]
    const textValue = typeof raw === "string" ? raw.trim() : ""
    return textValue === "" ? [] : [{ label, value: textValue, block: true }]
  })
}

function resolutionLabel(value: ClaudeFingerprintView): string {
  if (value.resolution === "custom") return value.customResolution || "自定义（未填写）"
  return value.resolution || "按窗口自动"
}

function noiseLabel(value: FingerprintNoise): string {
  if (value === "1") return "开启"
  if (value === "0") return "关闭"
  return "不输出（跟随默认）"
}

function webrtcLabel(value: FingerprintWebrtcPolicy): string {
  const option = fingerprintWebrtcOptions.find((item) => item.value === value)
  return option?.label ?? "跟随默认"
}

function spoofingLabel(value: FingerprintSpoofingCategory[] | undefined): string {
  const categories = normalizeSpoofing(value)
  if (categories.length === 0) return "不额外禁用"
  return categories
    .map((category) => fingerprintSpoofingCategories.find((item) => item.value === category)?.label)
    .filter((label): label is string => label !== undefined)
    .join("、")
}

function platformLabel(value: string): string {
  if (value === "windows") return "Windows"
  if (value === "linux") return "Linux"
  return "macOS"
}

function suffix(value: string | undefined): string {
  return value === undefined || value === "" ? "" : ` ${value}`
}

const langPattern = /^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8}){0,2}$/

function isValidAcceptLang(value: string): boolean {
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "")
  return items.length > 0 && items.every((item) => langPattern.test(item))
}

function isWindowSize(value: string): boolean {
  const match = /^(\d{3,5}),(\d{3,5})$/.exec(value)
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

function normalizePlatform(value: string | undefined): string {
  const normalized = text(value).toLowerCase()
  return normalized === "mac" ? "macos" : normalized
}

function normalizeNoise(value: unknown): FingerprintNoise {
  if (value === "1" || value === "0") return value
  if (value === true) return "1"
  if (value === false) return "0"
  return ""
}

function normalizeWebrtc(value: unknown): FingerprintWebrtcPolicy {
  return fingerprintWebrtcOptions.some((option) => option.value === value)
    ? (value as FingerprintWebrtcPolicy)
    : ""
}

function normalizeSpoofing(value: unknown): FingerprintSpoofingCategory[] {
  if (!Array.isArray(value)) return []
  return fingerprintSpoofingCategories
    .map((category) => category.value)
    .filter((category) => value.includes(category))
}

function normalizeAcceptLang(value: string | undefined): string {
  return text(value)
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "")
    .join(",")
}

function normalizeArgs(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item !== "")
}

function isNoise(value: unknown): value is FingerprintNoise {
  return value === "" || value === "0" || value === "1"
}

function isSpoofingCategory(value: unknown): value is FingerprintSpoofingCategory {
  return fingerprintSpoofingCategories.some((item) => item.value === value)
}

function isString(value: unknown): value is string {
  return typeof value === "string"
}

function text(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : ""
}
