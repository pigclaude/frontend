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

/** 兼容字段标签；摘要里出现时说明这些值只作为旧配置保留。 */
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
  "choice" | "select" | "resolution" | "custom-resolution" | "noise" | "spoofing" | "args"

/** 下拉选项。 */
export type FingerprintFieldOption = { value: string; label: string; keywords?: string[] }

/** 单个字段的展示元数据。保证标签、提示和控件类型集中在这一处。 */
export type FingerprintFieldMeta = {
  label: string
  hint?: string
  placeholder?: string
  mono?: boolean
  control: FingerprintFieldControl
  options?: FingerprintFieldOption[]
  defaultLabel?: string
}

/** 一个设置分组，供编辑面板与字段错误导航共同使用。 */
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
  { value: "", label: "跟随屏幕" },
  ...fingerprintResolutionPresets.map((value) => ({ value, label: value.replace(",", " × ") })),
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
  { value: "", label: "默认" },
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
    hint: "自动模式按账号生成；也可以手动生成或填写一个固定种子。",
    placeholder: "1–2147483647",
    defaultLabel: "按账号自动生成",
    mono: true,
    control: "choice",
  },
  brand: { label: "浏览器品牌", control: "select", options: fingerprintBrandOptions },
  brandVersion: {
    label: "浏览器版本",
    placeholder: "例如 148.0.7778.215",
    defaultLabel: "跟随内核版本",
    mono: true,
    control: "choice",
  },
  platform: { label: "操作系统", control: "select", options: fingerprintPlatformOptions },
  platformVersion: {
    label: "系统版本",
    placeholder: "例如 15.2.0",
    defaultLabel: "使用默认版本",
    mono: true,
    control: "choice",
  },
  lang: {
    label: "浏览器语言",
    placeholder: "例如 zh-CN",
    defaultLabel: "跟随系统语言",
    control: "choice",
  },
  acceptLang: {
    label: "首选语言列表",
    placeholder: "例如 zh-CN,zh,en-US,en",
    defaultLabel: "跟随浏览器语言",
    control: "choice",
  },
  timezone: {
    label: "时区",
    hint: "可选择常用地区，其他地区可自定义 IANA 时区名称。",
    placeholder: "例如 Asia/Shanghai",
    defaultLabel: "跟随系统时区",
    control: "choice",
  },
  resolution: {
    label: "窗口大小",
    hint: "默认根据本机屏幕自动设置。",
    control: "resolution",
    options: fingerprintResolutionOptions,
  },
  customResolution: {
    label: "自定义窗口大小",
    hint: "用逗号分隔宽和高，均不小于 200。",
    placeholder: "2560,1440",
    mono: true,
    control: "custom-resolution",
  },
  hardwareConcurrency: {
    label: "CPU 核心数",
    hint: "可设置 1–128 核。",
    placeholder: "1–128",
    defaultLabel: "使用默认核心数",
    mono: true,
    control: "choice",
  },
  webrtcPolicy: {
    label: "WebRTC 策略",
    control: "select",
    options: fingerprintWebrtcOptions,
  },
  canvasNoise: { label: "Canvas 噪声", hint: "为画布图像添加细微差异。", control: "noise" },
  clientRectsNoise: {
    label: "ClientRects 噪声",
    hint: "为元素布局测量添加细微差异。",
    control: "noise",
  },
  disableSpoofing: {
    label: "停用特征伪装",
    hint: "打开开关后，对应特征使用原始值，适合排查页面兼容问题。",
    control: "spoofing",
  },
  unknownArgs: {
    label: "自定义启动参数",
    hint: "每行填写一个参数，将在启动浏览器时追加。",
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
    description: "设置网站读取到的浏览器、系统和地区信息。",
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
  },
  {
    id: "device",
    title: "设备与网络",
    description: "调整浏览器窗口、硬件配置和网络连接方式。",
    fields: ["resolution", "customResolution", "hardwareConcurrency", "webrtcPolicy"],
  },
  {
    id: "compat",
    title: "隐私与兼容",
    description: "管理图像噪声，以及需要保留原始值的特征。",
    fields: ["canvasNoise", "clientRectsNoise", "disableSpoofing"],
  },
  {
    id: "advanced",
    title: "高级设置",
    description: "添加其他浏览器启动选项。通常保持为空即可。",
    fields: ["unknownArgs"],
  },
]
