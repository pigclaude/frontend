// 负责外观页编辑主题的纯规则：编辑哪个模式、显示什么颜色、是否「已修改」、还原、切换主题与强调色方式。
import type { Hex } from "./color-math"
import type { AppearanceSettings, ModeOverrides, ThemeSlot } from "./appearance-settings"
import { activeSlot, setOverride } from "./appearance-settings"
import type { ThemeColors, ThemeDefinition } from "./theme-presets"
import { serializeTheme } from "./theme-file"
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

/** 改回默认强调色时要清的模式：分别设置时只清 tone，共用一个槽时两个模式都清。 */
function clearAccent(settings: AppearanceSettings, tone: Tone): AppearanceSettings {
  const tones: Tone[] = settings.splitModes ? [tone] : ["light", "dark"]
  return tones.reduce((next, side) => setOverride(next, side, "accent", null), settings)
}

/**
 * 「还原为 {主题}」：清掉当前主题在 tone 模式下的背景和前景修改，该槽的强调色方式回到默认
 * 并清掉对应的强调色修改；另一个模式的背景和前景不变。
 */
export function restoreTheme(settings: AppearanceSettings, tone: Tone): AppearanceSettings {
  let next = updateSlot(settings, tone, { accentMode: "default" })
  for (const key of ["bg", "fg"] as const) next = setOverride(next, tone, key, null)
  return clearAccent(next, tone)
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
 * 让变化立即可见；切回默认时清掉强调色修改（共用一个槽时两个模式都清）。
 */
export function setAccentMode(
  settings: AppearanceSettings,
  custom: readonly ThemeDefinition[],
  tone: Tone,
  mode: ThemeSlot["accentMode"],
): AppearanceSettings {
  const next = updateSlot(settings, tone, { accentMode: mode })
  if (mode === "default") return clearAccent(next, tone)
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

/**
 * 把编辑中主题的两个模式连同修改合成一组颜色，供另存和导出使用。某个模式的强调色修改
 * 只在该模式实际用这个主题且强调色为自定义时才合入（否则看编辑中的槽），不会带出看不见的颜色。
 */
export function bakeTheme(
  settings: AppearanceSettings,
  custom: readonly ThemeDefinition[],
  tone: Tone,
): Record<Tone, ThemeColors> {
  const slot = activeSlot(settings, tone)
  const theme = findTheme(slot.themeId, custom)
  const overrides = settings.overrides[theme.id]
  const customAccent = (side: Tone) => {
    const own = activeSlot(settings, side)
    return (own.themeId === theme.id ? own : slot).accentMode === "custom"
  }
  return {
    light: merged(theme.light ?? pigclaudeFallback.light, overrides?.light, customAccent("light")),
    dark: merged(theme.dark ?? pigclaudeFallback.dark, overrides?.dark, customAccent("dark")),
  }
}

/** 把编辑中的主题（含看得见的修改）输出成主题 JSON，供「复制」使用。 */
export function exportTheme(
  settings: AppearanceSettings,
  custom: readonly ThemeDefinition[],
  tone: Tone,
): string {
  const theme = findTheme(activeSlot(settings, tone).themeId, custom)
  return serializeTheme(
    { ...theme, ...bakeTheme(settings, custom, tone) },
    undefined,
    pigclaudeFallback,
  )
}

/** 主题被删除后：用到它的槽回到 pigclaude 和默认强调色，并删掉它的修改记录。 */
export function forgetTheme(settings: AppearanceSettings, themeId: string): AppearanceSettings {
  const reset = (slot: ThemeSlot): ThemeSlot =>
    slot.themeId === themeId ? { ...slot, themeId: "pigclaude", accentMode: "default" } : slot
  const overrides = { ...settings.overrides }
  delete overrides[themeId]
  return { ...settings, light: reset(settings.light), dark: reset(settings.dark), overrides }
}

/**
 * 另存为自定义主题之后：所有用原主题的模式都切到新主题（新主题已含两个模式的修改），
 * 只删掉被切走的模式的原主题修改；仍在用别的主题的模式和它们的记录不动。
 */
export function adoptSavedTheme(
  settings: AppearanceSettings,
  tone: Tone,
  savedId: string,
): AppearanceSettings {
  const source = activeSlot(settings, tone).themeId
  const moved: Tone[] = settings.splitModes
    ? (["light", "dark"] as const).filter((side) => settings[side].themeId === source)
    : ["light", "dark"]
  const entry: ModeOverrides = { ...settings.overrides[source] }
  for (const side of moved) delete entry[side]
  const overrides = { ...settings.overrides }
  if (Object.keys(entry).length > 0) overrides[source] = entry
  else delete overrides[source]
  let next: AppearanceSettings = { ...settings, overrides }
  for (const side of moved) next = selectTheme(next, side, savedId)
  return next
}
