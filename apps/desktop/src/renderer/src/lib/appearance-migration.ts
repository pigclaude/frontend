// 负责把旧 PigClaude 外观迁移到 Pigcode 控制器读取的结构，保留用户的主题和字号。
import {
  appearanceKey,
  customThemesKey,
  defaultAppearance,
  parseCustomThemes,
  parseStoredAppearance,
  serializeAppearance,
  type AppearanceSettings,
  type AppearanceStorage,
  type ThemeDefinition,
} from "@pigclaude/ui-primitives"
import { parseAppearance as parseLegacyAppearance } from "../models/appearance-settings"

const previousAppearanceKey = "pigclaude-appearance"
const previousThemesKey = "pigclaude-themes"
const previousModeKey = "pigclaude-theme"

const oldDefault = "pigclaude"
const newDefault = defaultAppearance.light.themeId

/** 旧版磨砂值迁到侧栏，旧默认主题及其颜色修改迁到新默认主题。 */
export function migrateAppearance(
  raw: string | null,
  customThemes: string | null,
  mode: string | null,
): { settings: AppearanceSettings; customThemes: ThemeDefinition[] } {
  const legacy = parseLegacyAppearance(raw, mode)
  const adaptSlot = (slot: typeof legacy.light) => ({
    ...slot,
    themeId: slot.themeId === oldDefault ? newDefault : slot.themeId,
  })
  const overrides = { ...legacy.overrides }
  const base = overrides[oldDefault]
  if (base) {
    delete overrides[oldDefault]
    overrides[newDefault] = base
  }
  return {
    settings: {
      ...legacy,
      glass: defaultAppearance.glass,
      light: adaptSlot(legacy.light),
      dark: adaptSlot(legacy.dark),
      overrides,
    },
    customThemes: parseCustomThemes(customThemes),
  }
}

/** 按独立键迁移一次，保留已写入的新设置及原始数据。 */
export function migrateAppearanceStorage(storage: AppearanceStorage): void {
  const current = storage.getItem(appearanceKey)
  const themes = storage.getItem(customThemesKey)
  const old = storage.getItem(previousAppearanceKey)
  const oldThemes = storage.getItem(previousThemesKey)
  const oldMode = storage.getItem(previousModeKey)
  if (old === null && oldThemes === null && oldMode === null) return
  const migrated = migrateAppearance(old, oldThemes, oldMode)
  if (current === null || parseStoredAppearance(current) === null) {
    storage.setItem(appearanceKey, serializeAppearance(migrated.settings))
  }
  if (themes === null) storage.setItem(customThemesKey, JSON.stringify(migrated.customThemes))
}
