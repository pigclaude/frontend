// 负责集中指纹表单的字段分组、控件元数据和下拉选项；不包含校验或业务逻辑。
// 授权步骤、账号编辑弹层和账号详情都从这里读取同一份标签与顺序。

import { desktopText } from "../locale/text"
import type {
  ClaudeFingerprintView,
  FingerprintNoise,
  FingerprintSpoofingCategory,
} from "@pigclaude/contracts/claude-account"

/** 指纹分组标识；快速生成不作为字段分组，由预设清单单独渲染。 */
export type FingerprintGroupId = "identity" | "device" | "compat" | "advanced"

/** 指纹字段键，覆盖契约里的全部 25 个字段。 */
export type FingerprintFieldKey = keyof ClaudeFingerprintView

/** 只保存和诊断、AntBrowser 1.8.0 不作为独立运行参数的 9 个旧字段。 */
export type FingerprintLegacyFieldKey =
  | "colorDepth"
  | "deviceMemory"
  | "touchPoints"
  | "doNotTrack"
  | "mediaDevices"
  | "audioNoise"
  | "fontList"
  | "webglVendor"
  | "webglRenderer"

/** 表单里可以编辑的字段键；旧字段只在摘要/诊断里展示。 */
export type FingerprintEditableFieldKey = Exclude<FingerprintFieldKey, FingerprintLegacyFieldKey>

/** 兼容字段标签；摘要里出现时说明这些值只作为旧配置保留。 */
export const fingerprintLegacyFields: { key: FingerprintLegacyFieldKey; label: string }[] = [
  { key: "colorDepth", label: desktopText("fingerprint.fingerprint-fields.1") },
  { key: "deviceMemory", label: desktopText("fingerprint.fingerprint-fields.2") },
  { key: "touchPoints", label: desktopText("fingerprint.fingerprint-fields.3") },
  { key: "doNotTrack", label: "Do Not Track" },
  { key: "mediaDevices", label: desktopText("fingerprint.fingerprint-fields.4") },
  { key: "audioNoise", label: desktopText("fingerprint.fingerprint-fields.5") },
  { key: "fontList", label: desktopText("fingerprint.fingerprint-fields.6") },
  { key: "webglVendor", label: desktopText("fingerprint.fingerprint-fields.7") },
  { key: "webglRenderer", label: desktopText("fingerprint.fingerprint-fields.8") },
]

/** 表单控件的渲染方式。 */
export type FingerprintFieldControl =
  "choice" | "select" | "resolution" | "custom-resolution" | "noise" | "spoofing" | "args"

/** 下拉选项。 */
export type FingerprintFieldOption = {
  value: string
  label: string
  keywords?: string[] | undefined
}

/** 单个字段的展示元数据。保证标签、提示和控件类型集中在这一处。 */
export type FingerprintFieldMeta = {
  label: string
  hint?: string
  placeholder?: string | undefined
  mono?: boolean
  control: FingerprintFieldControl
  options?: FingerprintFieldOption[]
  defaultLabel?: string
}

/** 分组里的一个小组，对应设置页的一张分组卡片；有说明时只含一个字段，说明即该字段的提示。 */
export type FingerprintSection = {
  title: string
  description?: string | undefined
  fields: FingerprintEditableFieldKey[]
}

/** 一个设置分组，供编辑面板与字段错误导航共同使用；sections 覆盖 fields 里的每个字段一次。 */
export type FingerprintGroup = {
  id: FingerprintGroupId
  title: string
  description: string
  fields: FingerprintEditableFieldKey[]
  sections: FingerprintSection[]
}

/** 品牌下拉；与 AntBrowser 支持的四个 Chromium 品牌一致。 */
export const fingerprintBrandOptions: FingerprintFieldOption[] = [
  { value: "Chrome", label: "Chrome" },
  { value: "Edge", label: "Edge" },
  { value: "Opera", label: "Opera" },
  { value: "Vivaldi", label: "Vivaldi" },
]

/** 平台下拉；mac 在归一化时统一成 macos。 */
export const fingerprintPlatformOptions: FingerprintFieldOption[] = [
  { value: "macos", label: "macOS" },
  { value: "windows", label: "Windows" },
  { value: "linux", label: "Linux" },
]

/** 窗口大小预设；与主进程允许的六个预设保持一致。 */
export const fingerprintResolutionPresets = [
  "1920,1080",
  "1440,900",
  "1366,768",
  "2560,1440",
  "1280,800",
  "1600,900",
] as const

/** 窗口大小下拉选项；空值表示按宿主屏幕自动计算。 */
export const fingerprintResolutionOptions: FingerprintFieldOption[] = [
  { value: "", label: desktopText("fingerprint.fingerprint-fields.9") },
  ...fingerprintResolutionPresets.map((value) => ({ value, label: value.replace(",", " × ") })),
  { value: "custom", label: desktopText("fingerprint.fingerprint-fields.10") },
]

/** WebRTC 策略下拉选项。 */
export const fingerprintWebrtcOptions: FingerprintFieldOption[] = [
  { value: "", label: desktopText("fingerprint.fingerprint-fields.11") },
  { value: "disable_non_proxied_udp", label: desktopText("fingerprint.fingerprint-fields.12") },
  {
    value: "default_public_interface_only",
    label: desktopText("fingerprint.fingerprint-fields.13"),
  },
  {
    value: "default_public_and_private_interfaces",
    label: desktopText("fingerprint.fingerprint-fields.14"),
  },
]

/** 噪声三态选项；空字符串表示启动时不输出该 flag。 */
export const fingerprintNoiseOptions: { value: FingerprintNoise; label: string }[] = [
  { value: "", label: desktopText("fingerprint.fingerprint-fields.15") },
  { value: "1", label: desktopText("fingerprint.fingerprint-fields.16") },
  { value: "0", label: desktopText("fingerprint.fingerprint-fields.17") },
]

/** 可单独禁用的伪装类别。 */
export const fingerprintSpoofingCategories: {
  value: FingerprintSpoofingCategory
  label: string
}[] = [
  { value: "font", label: desktopText("fingerprint.fingerprint-fields.18") },
  { value: "audio", label: desktopText("fingerprint.fingerprint-fields.19") },
  { value: "canvas", label: "Canvas" },
  { value: "clientrects", label: "ClientRects" },
  { value: "gpu", label: "GPU" },
]

/** 全部字段元数据；表单、摘要和测试共用同一份标签。 */
export const fingerprintFieldMeta: Record<FingerprintEditableFieldKey, FingerprintFieldMeta> = {
  seed: {
    label: desktopText("fingerprint.fingerprint-fields.20"),
    hint: desktopText("fingerprint.fingerprint-fields.21"),
    placeholder: "0–18446744073709551615",
    defaultLabel: desktopText("fingerprint.fingerprint-fields.22"),
    mono: true,
    control: "choice",
  },
  brand: {
    label: desktopText("fingerprint.fingerprint-fields.23"),
    control: "select",
    options: fingerprintBrandOptions,
  },
  brandVersion: {
    label: desktopText("fingerprint.fingerprint-fields.24"),
    placeholder: desktopText("fingerprint.fingerprint-fields.25"),
    defaultLabel: desktopText("fingerprint.fingerprint-fields.26"),
    mono: true,
    control: "choice",
  },
  platform: {
    label: desktopText("fingerprint.fingerprint-fields.27"),
    control: "select",
    options: fingerprintPlatformOptions,
  },
  platformVersion: {
    label: desktopText("fingerprint.fingerprint-fields.28"),
    placeholder: desktopText("fingerprint.fingerprint-fields.29"),
    defaultLabel: desktopText("fingerprint.fingerprint-fields.30"),
    mono: true,
    control: "choice",
  },
  lang: {
    label: desktopText("fingerprint.fingerprint-fields.31"),
    placeholder: desktopText("fingerprint.fingerprint-fields.32"),
    defaultLabel: desktopText("fingerprint.fingerprint-fields.33"),
    control: "choice",
  },
  acceptLang: {
    label: desktopText("fingerprint.fingerprint-fields.34"),
    placeholder: desktopText("fingerprint.fingerprint-fields.35"),
    defaultLabel: desktopText("fingerprint.fingerprint-fields.36"),
    control: "choice",
  },
  timezone: {
    label: desktopText("fingerprint.fingerprint-fields.37"),
    hint: desktopText("fingerprint.fingerprint-fields.38"),
    placeholder: desktopText("fingerprint.fingerprint-fields.39"),
    defaultLabel: desktopText("fingerprint.fingerprint-fields.40"),
    control: "choice",
  },
  resolution: {
    label: desktopText("fingerprint.fingerprint-fields.41"),
    hint: desktopText("fingerprint.fingerprint-fields.42"),
    control: "resolution",
    options: fingerprintResolutionOptions,
  },
  customResolution: {
    label: desktopText("fingerprint.fingerprint-fields.43"),
    hint: desktopText("fingerprint.fingerprint-fields.44"),
    placeholder: "2560,1440",
    mono: true,
    control: "custom-resolution",
  },
  hardwareConcurrency: {
    label: desktopText("fingerprint.fingerprint-fields.45"),
    hint: desktopText("fingerprint.fingerprint-fields.46"),
    placeholder: "1–128",
    defaultLabel: desktopText("fingerprint.fingerprint-fields.47"),
    mono: true,
    control: "choice",
  },
  webrtcPolicy: {
    label: desktopText("fingerprint.fingerprint-fields.48"),
    control: "select",
    options: fingerprintWebrtcOptions,
  },
  canvasNoise: {
    label: desktopText("fingerprint.fingerprint-fields.49"),
    hint: desktopText("fingerprint.fingerprint-fields.50"),
    control: "noise",
  },
  clientRectsNoise: {
    label: desktopText("fingerprint.fingerprint-fields.51"),
    hint: desktopText("fingerprint.fingerprint-fields.52"),
    control: "noise",
  },
  disableSpoofing: {
    label: desktopText("fingerprint.fingerprint-fields.53"),
    hint: desktopText("fingerprint.fingerprint-fields.54"),
    control: "spoofing",
  },
  unknownArgs: {
    label: desktopText("fingerprint.fingerprint-fields.55"),
    hint: desktopText("fingerprint.fingerprint-fields.56"),
    placeholder: "--disable-gpu",
    mono: true,
    control: "args",
  },
}

/** 表单分组；快速生成由预设按钮单独渲染，不放进字段分组。 */
export const fingerprintGroups: FingerprintGroup[] = [
  {
    id: "identity",
    title: desktopText("fingerprint.fingerprint-fields.57"),
    description: desktopText("fingerprint.fingerprint-fields.58"),
    fields: [
      "brand",
      "platform",
      "brandVersion",
      "platformVersion",
      "lang",
      "timezone",
      "acceptLang",
      "seed",
    ],
    sections: [
      {
        title: desktopText("fingerprint.fingerprint-fields.59"),
        fields: ["brand", "brandVersion"],
      },
      {
        title: desktopText("fingerprint.fingerprint-fields.60"),
        fields: ["platform", "platformVersion"],
      },
      {
        title: desktopText("fingerprint.fingerprint-fields.61"),
        fields: ["lang", "acceptLang", "timezone"],
      },
      { title: desktopText("fingerprint.fingerprint-fields.62"), fields: ["seed"] },
    ],
  },
  {
    id: "device",
    title: desktopText("fingerprint.fingerprint-fields.63"),
    description: desktopText("fingerprint.fingerprint-fields.64"),
    fields: ["resolution", "customResolution", "hardwareConcurrency", "webrtcPolicy"],
    sections: [
      {
        title: desktopText("fingerprint.fingerprint-fields.65"),
        fields: ["resolution", "customResolution"],
      },
      { title: desktopText("fingerprint.fingerprint-fields.66"), fields: ["hardwareConcurrency"] },
      { title: desktopText("fingerprint.fingerprint-fields.67"), fields: ["webrtcPolicy"] },
    ],
  },
  {
    id: "compat",
    title: desktopText("fingerprint.fingerprint-fields.68"),
    description: desktopText("fingerprint.fingerprint-fields.69"),
    fields: ["canvasNoise", "clientRectsNoise", "disableSpoofing"],
    sections: [
      {
        title: desktopText("fingerprint.fingerprint-fields.70"),
        fields: ["canvasNoise", "clientRectsNoise"],
      },
      {
        title: desktopText("fingerprint.fingerprint-fields.71"),
        description: fingerprintFieldMeta.disableSpoofing.hint,
        fields: ["disableSpoofing"],
      },
    ],
  },
  {
    id: "advanced",
    title: desktopText("fingerprint.fingerprint-fields.72"),
    description: desktopText("fingerprint.fingerprint-fields.73"),
    fields: ["unknownArgs"],
    sections: [
      { title: desktopText("fingerprint.fingerprint-fields.74"), fields: ["unknownArgs"] },
    ],
  },
]
