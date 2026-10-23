// 负责定义主题色预设、默认靛紫与精确保留的旧蓝色表。
import { deriveAccent } from "@pigclaude/web-ui/lib/accent-derive"

/** 可持久化的八种预设标识，顺序由预设表保证。 */
export type AccentPresetId =
  "indigo" | "blue" | "rose" | "clay" | "teal" | "green" | "red" | "amber"
/** 深色或浅色模式所需的完整主题色 token。 */
export interface AccentTokens {
  accent: string
  accentOn: string
  accentHover: string
  accentActive: string
  accentGlow: string
  accentInk: string
  landingInkFrom: string
  landingInkTo: string
}
/** 同一品牌色的两套深浅主题 token。 */
export interface AccentPalette {
  dark: AccentTokens
  light: AccentTokens
}
/** 带有稳定标识、中文名称和品牌色的主题色预设。 */
export interface AccentPreset extends AccentPalette {
  id: AccentPresetId
  label: string
  brand: string
}
/** 默认主题使用靛紫。 */
export const DEFAULT_ACCENT: AccentPresetId = "indigo"
/** 按产品顺序提供预设，靛紫与蓝色逐字段保留约定值。 */
export const ACCENT_PRESETS: readonly AccentPreset[] = [
  {
    id: "indigo",
    label: "靛紫",
    brand: "#8b7cf6",
    dark: {
      accent: "#6352d9",
      accentOn: "#ffffff",
      accentHover: "#8b7cf6",
      accentActive: "#4c3db8",
      accentGlow: "#8b7cf6",
      accentInk: "#8b7cf6",
      landingInkFrom: "#c9c1fd",
      landingInkTo: "#8b7cf6",
    },
    light: {
      accent: "#6352d9",
      accentOn: "#ffffff",
      accentHover: "#6352d9",
      accentActive: "#4c3db8",
      accentGlow: "#8b7cf6",
      accentInk: "#6352d9",
      landingInkFrom: "#8b7cf6",
      landingInkTo: "#6352d9",
    },
  },
  {
    id: "blue",
    label: "蓝",
    brand: "#3a83f7",
    dark: {
      accent: "#2c67c5",
      accentOn: "#ffffff",
      accentHover: "#3a83f7",
      accentActive: "#1f4e94",
      accentGlow: "#3a83f7",
      accentInk: "#3a83f7",
      landingInkFrom: "#a9cffb",
      landingInkTo: "#3a83f7",
    },
    light: {
      accent: "#2c67c5",
      accentOn: "#ffffff",
      accentHover: "#3a83f7",
      accentActive: "#1f4e94",
      accentGlow: "#3a83f7",
      accentInk: "#2c67c5",
      landingInkFrom: "#3a83f7",
      landingInkTo: "#2c67c5",
    },
  },
  ...(
    [
      ["rose", "猪鼻粉", "#ec6f8f"],
      ["clay", "陶土橙", "#d97757"],
      ["teal", "青绿", "#2bb3a3"],
      ["green", "绿", "#43aa67"],
      ["red", "红", "#e45b5b"],
      ["amber", "琥珀", "#e8ad35"],
    ] as const
  ).map(([id, label, brand]) => ({ id, label, brand, ...deriveAccent(brand) })),
]
