// 负责定义主题色预设、默认靛紫与精确保留的旧蓝色表。

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
  {
    id: "rose",
    label: "猪鼻粉",
    brand: "#ec6f8f",
    dark: {
      accent: "#c2496c",
      accentOn: "#ffffff",
      accentHover: "#ec6f8f",
      accentActive: "#a72f55",
      accentGlow: "#ec6f8f",
      accentInk: "#ec6f8f",
      landingInkFrom: "#ffc5d0",
      landingInkTo: "#ec6f8f",
    },
    light: {
      accent: "#c2496c",
      accentOn: "#ffffff",
      accentHover: "#c2496c",
      accentActive: "#a72f55",
      accentGlow: "#ec6f8f",
      accentInk: "#bf4669",
      landingInkFrom: "#ec6f8f",
      landingInkTo: "#bf4669",
    },
  },
  {
    id: "clay",
    label: "陶土橙",
    brand: "#d97757",
    dark: {
      accent: "#b75939",
      accentOn: "#ffffff",
      accentHover: "#d97757",
      accentActive: "#9d4121",
      accentGlow: "#d97757",
      accentInk: "#d97757",
      landingInkFrom: "#fdbda8",
      landingInkTo: "#d97757",
    },
    light: {
      accent: "#b75939",
      accentOn: "#ffffff",
      accentHover: "#b75939",
      accentActive: "#9d4121",
      accentGlow: "#d97757",
      accentInk: "#b45636",
      landingInkFrom: "#d97757",
      landingInkTo: "#b45636",
    },
  },
  {
    id: "teal",
    label: "青绿",
    brand: "#2bb3a3",
    dark: {
      accent: "#098578",
      accentOn: "#ffffff",
      accentHover: "#2bb3a3",
      accentActive: "#086a60",
      accentGlow: "#2bb3a3",
      accentInk: "#2bb3a3",
      landingInkFrom: "#73eedc",
      landingInkTo: "#2bb3a3",
    },
    light: {
      accent: "#098578",
      accentOn: "#ffffff",
      accentHover: "#098578",
      accentActive: "#086a60",
      accentGlow: "#2bb3a3",
      accentInk: "#0a7e72",
      landingInkFrom: "#2bb3a3",
      landingInkTo: "#0a7e72",
    },
  },
  {
    id: "green",
    label: "绿",
    brand: "#43aa67",
    dark: {
      accent: "#148847",
      accentOn: "#ffffff",
      accentHover: "#43aa67",
      accentActive: "#046e36",
      accentGlow: "#43aa67",
      accentInk: "#43aa67",
      landingInkFrom: "#80e59e",
      landingInkTo: "#43aa67",
    },
    light: {
      accent: "#148847",
      accentOn: "#ffffff",
      accentHover: "#148847",
      accentActive: "#046e36",
      accentGlow: "#43aa67",
      accentInk: "#048241",
      landingInkFrom: "#43aa67",
      landingInkTo: "#048241",
    },
  },
  {
    id: "red",
    label: "红",
    brand: "#e45b5b",
    dark: {
      accent: "#cf474a",
      accentOn: "#ffffff",
      accentHover: "#e45b5b",
      accentActive: "#b32c33",
      accentGlow: "#e45b5b",
      accentInk: "#e45b5b",
      landingInkFrom: "#feafaa",
      landingInkTo: "#e45b5b",
    },
    light: {
      accent: "#cf474a",
      accentOn: "#ffffff",
      accentHover: "#cf474a",
      accentActive: "#b32c33",
      accentGlow: "#e45b5b",
      accentInk: "#c84144",
      landingInkFrom: "#e45b5b",
      landingInkTo: "#c84144",
    },
  },
  {
    id: "amber",
    label: "琥珀",
    brand: "#e8ad35",
    dark: {
      accent: "#986d09",
      accentOn: "#ffffff",
      accentHover: "#e8ad35",
      accentActive: "#7a5808",
      accentGlow: "#e8ad35",
      accentInk: "#e8ad35",
      landingInkFrom: "#fee0ae",
      landingInkTo: "#e8ad35",
    },
    light: {
      accent: "#986d09",
      accentOn: "#ffffff",
      accentHover: "#986d09",
      accentActive: "#7a5808",
      accentGlow: "#e8ad35",
      accentInk: "#946a02",
      landingInkFrom: "#e8ad35",
      landingInkTo: "#946a02",
    },
  },
]
