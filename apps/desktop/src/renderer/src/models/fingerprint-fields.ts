// 负责集中指纹表单的字段分组、控件元数据和下拉选项；不包含校验或业务逻辑。
// 授权步骤、账号编辑弹层和账号详情都从这里读取同一份标签与顺序。

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

/** 旧字段标签；摘要里出现时统一标注不是 AntBrowser 的独立启动参数。 */
export const fingerprintLegacyFields: { key: FingerprintLegacyFieldKey; label: string }[] = [
  { key: "colorDepth", label: "色彩深度" },
  { key: "deviceMemory", label: "设备内存" },
  { key: "touchPoints", label: "触摸点数" },
  { key: "doNotTrack", label: "Do Not Track" },
  { key: "mediaDevices", label: "媒体设备" },
  { key: "audioNoise", label: "音频噪声" },
  { key: "fontList", label: "字体列表" },
  { key: "webglVendor", label: "WebGL 厂商" },
  { key: "webglRenderer", label: "WebGL 渲染器" },
]

/** 表单控件的渲染方式。 */
export type FingerprintFieldControl =
  "text" | "select" | "resolution" | "custom-resolution" | "noise" | "spoofing" | "args"

/** 下拉选项。 */
export type FingerprintFieldOption = { value: string; label: string }

/** 单个字段的展示元数据。保证标签、提示和控件类型集中在这一处。 */
export type FingerprintFieldMeta = {
  label: string
  hint?: string
  placeholder?: string
  mono?: boolean
  control: FingerprintFieldControl
  options?: FingerprintFieldOption[]
}

/** 一个表单分组。保证字段顺序与 AntBrowser 的编辑面板一致。 */
export type FingerprintGroup = {
  id: FingerprintGroupId
  title: string
  description: string
  fields: FingerprintEditableFieldKey[]
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
  { value: "", label: "按窗口自动" },
  ...fingerprintResolutionPresets.map((value) => ({ value, label: value })),
  { value: "custom", label: "自定义" },
]

/** WebRTC 策略下拉选项。 */
export const fingerprintWebrtcOptions: FingerprintFieldOption[] = [
  { value: "", label: "跟随默认" },
  { value: "disable_non_proxied_udp", label: "禁用非代理 UDP" },
  { value: "default_public_interface_only", label: "仅公网接口" },
  { value: "default_public_and_private_interfaces", label: "公网与私网接口" },
]

/** 噪声三态选项；空字符串表示启动时不输出该 flag。 */
export const fingerprintNoiseOptions: { value: FingerprintNoise; label: string }[] = [
  { value: "", label: "不输出" },
  { value: "1", label: "开启" },
  { value: "0", label: "关闭" },
]

/** 可单独禁用的伪装类别。 */
export const fingerprintSpoofingCategories: {
  value: FingerprintSpoofingCategory
  label: string
}[] = [
  { value: "font", label: "字体" },
  { value: "audio", label: "音频" },
  { value: "canvas", label: "Canvas" },
  { value: "clientrects", label: "ClientRects" },
  { value: "gpu", label: "GPU" },
]

/** 全部字段元数据；表单、摘要和测试共用同一份标签。 */
export const fingerprintFieldMeta: Record<FingerprintEditableFieldKey, FingerprintFieldMeta> = {
  seed: {
    label: "指纹种子",
    hint: "留空时按账号 ID 生成稳定整数，同一账号每次启动都一样。",
    placeholder: "留空自动生成",
    mono: true,
    control: "text",
  },
  brand: { label: "浏览器品牌", control: "select", options: fingerprintBrandOptions },
  brandVersion: {
    label: "品牌版本",
    hint: "数字点分，最多 5 段。",
    placeholder: "144.0.7559.132",
    mono: true,
    control: "text",
  },
  platform: { label: "平台", control: "select", options: fingerprintPlatformOptions },
  platformVersion: {
    label: "系统版本",
    hint: "可填 15.0.0、10.0.0 或 6.8.0。",
    placeholder: "15.0.0",
    mono: true,
    control: "text",
  },
  lang: { label: "语言", hint: "留空时使用系统语言。", placeholder: "zh-CN", control: "text" },
  acceptLang: {
    label: "Accept-Language",
    hint: "留空时由语言推导。",
    placeholder: "zh-CN,zh",
    control: "text",
  },
  timezone: {
    label: "时区",
    hint: "IANA 名称；system 表示跟随系统。",
    placeholder: "Asia/Shanghai 或 system",
    control: "text",
  },
  resolution: {
    label: "窗口大小",
    hint: "留空时按宿主屏幕计算，与 AntBrowser 新建 profile 一致。",
    control: "resolution",
    options: fingerprintResolutionOptions,
  },
  customResolution: {
    label: "自定义分辨率",
    hint: "宽,高，宽高都不小于 200。",
    placeholder: "2560,1440",
    mono: true,
    control: "custom-resolution",
  },
  hardwareConcurrency: {
    label: "CPU 核心数",
    hint: "1 到 128 的整数。",
    placeholder: "8",
    mono: true,
    control: "text",
  },
  webrtcPolicy: {
    label: "WebRTC 策略",
    control: "select",
    options: fingerprintWebrtcOptions,
  },
  canvasNoise: { label: "Canvas 噪声", control: "noise" },
  clientRectsNoise: { label: "ClientRects 噪声", control: "noise" },
  disableSpoofing: {
    label: "禁用伪装类别",
    hint: "与噪声开关互相独立，对应 --disable-spoofing。",
    control: "spoofing",
  },
  unknownArgs: {
    label: "原始参数",
    hint: "每行一个参数，按原样追加到启动命令末尾。",
    placeholder: "--disable-gpu",
    mono: true,
    control: "args",
  },
}

/** 表单分组；快速生成由预设按钮单独渲染，不放进字段分组。 */
export const fingerprintGroups: FingerprintGroup[] = [
  {
    id: "identity",
    title: "身份与定位",
    description: "品牌、平台、语言和时区共同决定网站看到的地区画像。",
    fields: [
      "seed",
      "brand",
      "brandVersion",
      "platform",
      "platformVersion",
      "lang",
      "acceptLang",
      "timezone",
    ],
  },
  {
    id: "device",
    title: "设备与网络",
    description: "窗口大小、CPU 核心数和 WebRTC 策略影响硬件与网络特征。",
    fields: ["resolution", "customResolution", "hardwareConcurrency", "webrtcPolicy"],
  },
  {
    id: "compat",
    title: "兼容伪装",
    description: "噪声三态和禁用伪装类别互相独立，不会互相替代。",
    fields: ["canvasNoise", "clientRectsNoise", "disableSpoofing"],
  },
  {
    id: "advanced",
    title: "高级原始参数",
    description:
      "原始参数会原样追加到启动命令；9 个旧字段只保存和诊断，不作为独立控件，AntBrowser 1.8.0 也不会输出它们。",
    fields: ["unknownArgs"],
  },
]
