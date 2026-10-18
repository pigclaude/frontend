// 负责外观页编辑主题的纯规则：编辑哪个模式、显示什么颜色、是否「已修改」、还原、切换主题与强调色方式。
import type { Hex } from "./color-math"
import type { AppearanceSettings, ModeOverrides, ThemeSlot } from "./appearance-settings"
import { activeSlot, setOverride } from "./appearance-settings"
import type { ThemeColors, ThemeDefinition } from "./theme-presets"
import { findTheme } from "./theme-presets"

/** 浅色或深色。 */
export type Tone = "light" | "dark"

/** 页面上显示的一组完整颜色。 */
export type ShownColors = { bg: Hex; fg: Hex; accent: Hex }

/** pigclaude 主题在 tokens.css 中对应的 hex（强调色取开关绿），用于显示和作为编辑起点。 */
export const pigclaudeColors: Record<Tone, ShownColors> = {
  light: { bg: "#F4F4F5", fg: "#18181B", accent: "#1F8A55" },
  dark: { bg: "#232325", fg: "#EEEEF0", accent: "#3FAE72" },
}

/** 导出或另存 pigclaude 时用的颜色；不带强调色，表示沿用 pigclaude 自己的规则。 */
export const pigclaudeFallback: Record<Tone, ThemeColors> = {
  light: { bg: pigclaudeColors.light.bg, fg: pigclaudeColors.light.fg },
  dark: { bg: pigclaudeColors.dark.bg, fg: pigclaudeColors.dark.fg },
}

/** 正在编辑哪个模式：分别设置时是分段选中的模式，否则是当前实际显示的模式。 */
export function editTone(settings: AppearanceSettings, resolved: Tone, editing: Tone): Tone {
  return settings.splitModes ? editing : resolved
}

/** tone 模式的主题和颜色：base 是主题原值，colors 合并了修改；强调色为默认时忽略强调色修改。 */
export function shownColors(
  settings: AppearanceSettings,
  custom: readonly ThemeDefinition[],
  tone: Tone,
): { theme: ThemeDefinition; slot: ThemeSlot; base: ShownColors; colors: ShownColors } {
  const slot = activeSlot(settings, tone)
  const theme = findTheme(slot.themeId, custom)
  const own = theme[tone]
  const base: ShownColors = {
    bg: own?.bg ?? pigclaudeColors[tone].bg,
    fg: own?.fg ?? pigclaudeColors[tone].fg,
    accent: own?.accent ?? pigclaudeColors[tone].accent,
  }
  const changed = settings.overrides[theme.id]?.[tone] ?? {}
  const accent = slot.accentMode === "custom" ? (changed.accent ?? base.accent) : base.accent
  return {
    theme,
    slot,
    base,
    colors: { bg: changed.bg ?? base.bg, fg: changed.fg ?? base.fg, accent },
  }
}

/** 当前主题在 tone 模式下是否被改过；强调色修改只在自定义强调色时算数。 */
export function isThemeModified(settings: AppearanceSettings, tone: Tone): boolean {
  const slot = activeSlot(settings, tone)
  const changed = settings.overrides[slot.themeId]?.[tone]
  if (!changed) return false
  return Boolean(changed.bg || changed.fg || (slot.accentMode === "custom" && changed.accent))
}

/** 清掉当前主题在 tone 模式下的全部修改，另一个模式不变。 */
export function restoreTheme(settings: AppearanceSettings, tone: Tone): AppearanceSettings {
  let next = settings
  for (const key of ["bg", "fg", "accent"] as const) next = setOverride(next, tone, key, null)
  return next
}

function updateSlot(
  settings: AppearanceSettings,
  tone: Tone,
  patch: Partial<ThemeSlot>,
): AppearanceSettings {
  const key = settings.splitModes ? tone : "light"
  return { ...settings, [key]: { ...settings[key], ...patch } }
}

/** 让 tone 模式使用 themeId；不分别设置时写共用的 light 槽。 */
export function selectTheme(
  settings: AppearanceSettings,
  tone: Tone,
  themeId: string,
): AppearanceSettings {
  return updateSlot(settings, tone, { themeId })
}

/** 改 tone 模式的界面字体；不分别设置时写共用的 light 槽。 */
export function selectUiFont(
  settings: AppearanceSettings,
  tone: Tone,
  uiFont: ThemeSlot["uiFont"],
): AppearanceSettings {
  return updateSlot(settings, tone, { uiFont })
}

/** 打开或关闭「分别设置」。打开时深色槽沿用当前共用的选择，界面不跳变；关闭时保留两个槽。 */
export function setSplitModes(settings: AppearanceSettings, on: boolean): AppearanceSettings {
  if (on === settings.splitModes) return settings
  return on
    ? { ...settings, splitModes: true, dark: { ...settings.light } }
    : { ...settings, splitModes: false }
}

/**
 * 切换强调色方式。切到自定义时，若主题没有自己的强调色（如 pigclaude），写入一个起始强调色，
 * 让变化立即可见；切回默认时清掉强调色修改。
 */
export function setAccentMode(
  settings: AppearanceSettings,
  custom: readonly ThemeDefinition[],
  tone: Tone,
  mode: ThemeSlot["accentMode"],
): AppearanceSettings {
  const next = updateSlot(settings, tone, { accentMode: mode })
  if (mode === "default") return setOverride(next, tone, "accent", null)
  const { theme } = shownColors(next, custom, tone)
  if (theme[tone]?.accent || next.overrides[theme.id]?.[tone]?.accent) return next
  return setOverride(next, tone, "accent", pigclaudeColors[tone].accent)
}

function merged(
  base: ThemeColors,
  override: ModeOverrides[Tone],
  customAccent: boolean,
): ThemeColors {
  const accent = (customAccent ? override?.accent : undefined) ?? base.accent
  return {
    bg: override?.bg ?? base.bg,
    fg: override?.fg ?? base.fg,
    ...(accent ? { accent } : {}),
  }
}

/** 把编辑中主题的两个模式连同修改合成一组颜色，供「另存为自定义主题」使用。 */
export function bakeTheme(
  settings: AppearanceSettings,
  custom: readonly ThemeDefinition[],
  tone: Tone,
): Record<Tone, ThemeColors> {
  const slot = activeSlot(settings, tone)
  const theme = findTheme(slot.themeId, custom)
  const overrides = settings.overrides[theme.id]
  const customAccent = slot.accentMode === "custom"
  return {
    light: merged(theme.light ?? pigclaudeFallback.light, overrides?.light, customAccent),
    dark: merged(theme.dark ?? pigclaudeFallback.dark, overrides?.dark, customAccent),
  }
}

/** 主题被删除后：用到它的槽回到 pigclaude 和默认强调色，并删掉它的修改记录。 */
export function forgetTheme(settings: AppearanceSettings, themeId: string): AppearanceSettings {
  const reset = (slot: ThemeSlot): ThemeSlot =>
    slot.themeId === themeId ? { ...slot, themeId: "pigclaude", accentMode: "default" } : slot
  const overrides = { ...settings.overrides }
  delete overrides[themeId]
  return { ...settings, light: reset(settings.light), dark: reset(settings.dark), overrides }
}

/** 另存为自定义主题之后：tone 模式切到新主题，原主题的修改已合进新主题，一并清掉。 */
export function adoptSavedTheme(
  settings: AppearanceSettings,
  tone: Tone,
  savedId: string,
): AppearanceSettings {
  const source = activeSlot(settings, tone).themeId
  const overrides = { ...settings.overrides }
  delete overrides[source]
  return selectTheme({ ...settings, overrides }, tone, savedId)
}
