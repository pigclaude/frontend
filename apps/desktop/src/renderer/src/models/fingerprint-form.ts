// 负责指纹表单的默认值、归一化、前端轻量校验、原始参数解析和详情摘要。
// 字段元数据在 fingerprint-fields.ts，预设画像在 fingerprint-presets.ts，两者统一从这里导出。

import { desktopText } from "../locale/text"
import {
  defaultClaudeFingerprint,
  normalizeFingerprintSeed,
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
 * 保证返回完整字段对象、受管文本去空白、平台别名归一，原始参数保留字符串与顺序。
 */
export function normalizeFingerprintForm(
  value: Partial<ClaudeFingerprintView> | null | undefined,
): ClaudeFingerprintView {
  const merged = { ...defaultClaudeFingerprint(), ...(value ?? {}) }
  return {
    seed: normalizeFingerprintSeed(text(merged.seed)) ?? text(merged.seed),
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
  if (normalizeFingerprintSeed(seed) === null) {
    errors.seed = desktopText("fingerprint.fingerprint-form.1")
  }

  const brand = value.brand.trim()
  if (brand !== "" && !fingerprintBrandOptions.some((option) => option.value === brand)) {
    errors.brand = desktopText("fingerprint.fingerprint-form.2")
  }
  const brandVersion = text(value.brandVersion)
  if (brandVersion !== "" && !/^\d+(?:\.\d+){0,4}$/.test(brandVersion)) {
    errors.brandVersion = desktopText("fingerprint.fingerprint-form.3")
  }

  const platform = normalizePlatform(value.platform)
  if (platform !== "" && !["windows", "linux", "macos"].includes(platform)) {
    errors.platform = desktopText("fingerprint.fingerprint-form.4")
  }
  const platformVersion = text(value.platformVersion)
  if (platformVersion !== "" && !/^[A-Za-z0-9._-]+$/.test(platformVersion)) {
    errors.platformVersion = desktopText("fingerprint.fingerprint-form.5")
  }

  const lang = value.lang.trim()
  if (lang !== "" && !langPattern.test(lang)) {
    errors.lang = desktopText("fingerprint.fingerprint-form.6")
  }
  const acceptLang = text(value.acceptLang)
  if (acceptLang !== "" && !isValidAcceptLang(acceptLang)) {
    errors.acceptLang = desktopText("fingerprint.fingerprint-form.7")
  }

  const timezone = value.timezone.trim()
  if (timezone !== "" && timezone.toLowerCase() !== "system" && !isTimeZone(timezone)) {
    errors.timezone = desktopText("fingerprint.fingerprint-form.8")
  }

  const resolution = text(value.resolution)
  if (resolution !== "") {
    if (resolution === "custom") {
      if (!isWindowSize(text(value.customResolution))) {
        errors.customResolution = desktopText("fingerprint.fingerprint-form.9")
      }
    } else if (!(fingerprintResolutionPresets as readonly string[]).includes(resolution)) {
      errors.resolution = desktopText("fingerprint.fingerprint-form.10")
    }
  }

  const hardwareConcurrency = text(value.hardwareConcurrency)
  if (hardwareConcurrency !== "" && !isIntegerInRange(hardwareConcurrency, 1, 128)) {
    errors.hardwareConcurrency = desktopText("fingerprint.fingerprint-form.11")
  }

  const webrtcPolicy = value.webrtcPolicy ?? ""
  if (!fingerprintWebrtcOptions.some((option) => option.value === webrtcPolicy)) {
    errors.webrtcPolicy = desktopText("fingerprint.fingerprint-form.12")
  }

  if (!isNoise(value.canvasNoise))
    errors.canvasNoise = desktopText("fingerprint.fingerprint-form.13")
  if (!isNoise(value.clientRectsNoise)) {
    errors.clientRectsNoise = desktopText("fingerprint.fingerprint-form.14")
  }

  const disabled = value.disableSpoofing
  if (disabled !== undefined && (!Array.isArray(disabled) || !disabled.every(isSpoofingCategory))) {
    errors.disableSpoofing = desktopText("fingerprint.fingerprint-form.15")
  }

  const args = value.unknownArgs
  if (args !== undefined && (!Array.isArray(args) || !args.every(isString))) {
    errors.unknownArgs = desktopText("fingerprint.fingerprint-form.16")
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

/** 把 textarea 文本拆成原始参数行；显式清空返回空数组，其余空行保留。 */
export function splitUnknownArgs(text: string): string[] {
  return text === "" ? [] : text.split(/\r?\n/)
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
  return `${normalized.lang || desktopText("fingerprint.fingerprint-form.17")} · ${normalized.timezone || desktopText("fingerprint.fingerprint-form.18")}`
}

/** 环境摘要里的一个小标签；mono 为 true 时按等宽字体显示。 */
export type FingerprintEnvironmentChip = { text: string; mono: boolean }

/** 环境摘要的小标签，依次是语言、时区、种子；空值使用与 fingerprintLocaleLine 相同的兜底文字。 */
export function fingerprintEnvironmentChips(
  value: ClaudeFingerprintView,
): FingerprintEnvironmentChip[] {
  const normalized = normalizeFingerprintForm(value)
  return [
    { text: normalized.lang || desktopText("fingerprint.fingerprint-form.19"), mono: false },
    { text: normalized.timezone || desktopText("fingerprint.fingerprint-form.20"), mono: false },
    normalized.seed === ""
      ? { text: desktopText("fingerprint.fingerprint-form.21"), mono: false }
      : {
          text: desktopText("fingerprint.fingerprint-form.22", { value1: String(normalized.seed) }),
          mono: true,
        },
  ]
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
      title: desktopText("fingerprint.fingerprint-form.23"),
      rows: [
        {
          label: desktopText("fingerprint.fingerprint-form.24"),
          value: value.seed || desktopText("fingerprint.fingerprint-form.25"),
        },
        {
          label: desktopText("fingerprint.fingerprint-form.26"),
          value: `${value.brand || "Chrome"}${suffix(value.brandVersion) || desktopText("fingerprint.fingerprint-form.27")}`,
        },
        {
          label: desktopText("fingerprint.fingerprint-form.28"),
          value: `${platformLabel(value.platform)}${suffix(value.platformVersion)}`,
        },
        {
          label: desktopText("fingerprint.fingerprint-form.29"),
          value: value.lang || desktopText("fingerprint.fingerprint-form.30"),
        },
        {
          label: "Accept-Language",
          value: value.acceptLang || desktopText("fingerprint.fingerprint-form.31"),
        },
        {
          label: desktopText("fingerprint.fingerprint-form.32"),
          value: value.timezone || desktopText("fingerprint.fingerprint-form.33"),
        },
      ],
    },
    {
      id: "device",
      title: desktopText("fingerprint.fingerprint-form.34"),
      rows: [
        { label: desktopText("fingerprint.fingerprint-form.35"), value: resolutionLabel(value) },
        {
          label: desktopText("fingerprint.fingerprint-form.36"),
          value: value.hardwareConcurrency || desktopText("fingerprint.fingerprint-form.37"),
        },
        { label: "WebRTC", value: webrtcLabel(value.webrtcPolicy ?? "") },
      ],
    },
    {
      id: "compat",
      title: desktopText("fingerprint.fingerprint-form.38"),
      rows: [
        {
          label: desktopText("fingerprint.fingerprint-form.39"),
          value: noiseLabel(value.canvasNoise),
        },
        {
          label: desktopText("fingerprint.fingerprint-form.40"),
          value: noiseLabel(value.clientRectsNoise),
        },
        {
          label: desktopText("fingerprint.fingerprint-form.41"),
          value: spoofingLabel(value.disableSpoofing),
        },
      ],
    },
    {
      id: "advanced",
      title: desktopText("fingerprint.fingerprint-form.42"),
      rows: [
        ...legacyRows,
        {
          label: desktopText("fingerprint.fingerprint-form.43"),
          value: value.unknownArgs?.join(" ") || desktopText("fingerprint.fingerprint-form.44"),
          block: true,
        },
      ],
      ...(legacyRows.length === 0 ? {} : { note: desktopText("fingerprint.fingerprint-form.45") }),
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
  if (value.resolution === "custom")
    return value.customResolution || desktopText("fingerprint.fingerprint-form.46")
  return value.resolution || desktopText("fingerprint.fingerprint-form.47")
}

function noiseLabel(value: FingerprintNoise): string {
  if (value === "1") return desktopText("fingerprint.fingerprint-form.48")
  if (value === "0") return desktopText("fingerprint.fingerprint-form.49")
  return desktopText("fingerprint.fingerprint-form.50")
}

function webrtcLabel(value: FingerprintWebrtcPolicy): string {
  const option = fingerprintWebrtcOptions.find((item) => item.value === value)
  return option?.label ?? desktopText("fingerprint.fingerprint-form.51")
}

function spoofingLabel(value: FingerprintSpoofingCategory[] | undefined): string {
  const categories = normalizeSpoofing(value)
  if (categories.length === 0) return desktopText("fingerprint.fingerprint-form.52")
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
  return value.filter((item): item is string => typeof item === "string")
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
