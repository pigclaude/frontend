// 负责外观页的主题分组：分别设置时的浅色/深色分段，以及主题、强调色、背景、前景、字体五行。
import { useMemo } from "react"
import { ColorPicker } from "../../../components/color-picker"
import { Icon } from "../../../components/icon"
import { Button } from "../../../components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "../../../components/ui/toggle-group"
import type { AppearanceController } from "../../../hooks/use-appearance"
import { isFontInstalled } from "../../../lib/font-detect"
import { accentSwatches } from "../../../models/color-picker-model"
import { installedFontOptions, uiFontOptions } from "../../../models/font-options"
import {
  isThemeModified,
  restoreTheme,
  selectTheme,
  selectUiFont,
  setAccentMode,
  setThemeColor,
  shownColors,
  type Tone,
} from "../../../models/theme-editing"
import type { ThemeDefinition } from "../../../models/theme-presets"
import { SettingRow, SettingSection } from "../setting-page"
import { ChoiceSelect } from "./choice-select"
import { ThemeMenu } from "./theme-menu"

/** 主题分组的参数。tone 是正在编辑的模式，editing/onEditing 只在分别设置时使用。 */
export type ThemeGroupProps = {
  appearance: AppearanceController
  tone: Tone
  onEditing: (tone: Tone) => void
  onImport: () => void
  onCopy: () => void
  onSaveAs: () => void
  onRename: (theme: ThemeDefinition) => void
  onRemove: (theme: ThemeDefinition) => void
}

const accentChoices = [
  { value: "default", label: "默认" },
  { value: "custom", label: "自定义" },
] as const

/** 渲染主题分组。颜色修改只写入正在编辑的模式，另一个模式不受影响。 */
export function ThemeGroup({
  appearance,
  tone,
  onEditing,
  onImport,
  onCopy,
  onSaveAs,
  onRename,
  onRemove,
}: ThemeGroupProps) {
  const { settings, customThemes, update } = appearance
  const { theme, slot, base, colors } = shownColors(settings, customThemes, tone)
  const modified = isThemeModified(settings, tone)
  const fonts = useMemo(
    () => installedFontOptions(uiFontOptions, slot.uiFont, isFontInstalled),
    [slot.uiFont],
  )
  const setMode = (mode: typeof slot.accentMode) =>
    update((current) => setAccentMode(current, customThemes, tone, mode))
  const setColor = (key: "bg" | "fg" | "accent") => (hex: `#${string}`) =>
    update((current) => setThemeColor(current, customThemes, tone, key, hex))

  return (
    <SettingSection className="tight">
      {settings.splitModes ? (
        <div className="item theme-tone-row">
          <ToggleGroup
            type="single"
            aria-label="正在编辑的模式"
            value={tone}
            onValueChange={(next) => {
              if (next === "light" || next === "dark") onEditing(next)
            }}
          >
            <ToggleGroupItem value="light" className="seg-icon-item">
              <Icon name="sun" small />
              浅色主题
            </ToggleGroupItem>
            <ToggleGroupItem value="dark" className="seg-icon-item">
              <Icon name="moon" small />
              深色主题
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      ) : null}
      <SettingRow title="主题">
        <span className="theme-actions">
          <Button
            variant="ghost"
            size="icon"
            aria-label="导入主题"
            title="导入主题"
            onClick={onImport}
          >
            <Icon name="download" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="复制主题 JSON"
            title="复制主题 JSON"
            onClick={onCopy}
          >
            <Icon name="copy" />
          </Button>
        </span>
        <ThemeMenu
          tone={tone}
          current={theme}
          accent={colors.accent}
          modified={modified}
          customThemes={customThemes}
          onSelect={(id) => update((current) => selectTheme(current, tone, id))}
          onImport={onImport}
          onSaveAs={onSaveAs}
          onRestore={() => update((current) => restoreTheme(current, tone))}
          onRename={onRename}
          onRemove={onRemove}
        />
      </SettingRow>
      <SettingRow title="强调色">
        <ChoiceSelect
          label="强调色"
          value={slot.accentMode}
          options={accentChoices}
          width={96}
          onChange={setMode}
        />
        {slot.accentMode === "custom" ? (
          <ColorPicker
            label="强调色"
            value={colors.accent}
            against={colors.bg}
            minContrast={3}
            swatches={accentSwatches}
            defaultValue={base.accent}
            onChange={setColor("accent")}
            onReset={() => setMode("default")}
          />
        ) : null}
      </SettingRow>
      <SettingRow title="背景">
        <ColorPicker
          label="背景"
          value={colors.bg}
          against={colors.fg}
          minContrast={4.5}
          defaultValue={base.bg}
          onChange={setColor("bg")}
        />
      </SettingRow>
      <SettingRow title="前景">
        <ColorPicker
          label="前景"
          value={colors.fg}
          against={colors.bg}
          minContrast={4.5}
          defaultValue={base.fg}
          onChange={setColor("fg")}
        />
      </SettingRow>
      <SettingRow title="字体">
        <ChoiceSelect
          label="界面字体"
          value={slot.uiFont}
          options={fonts}
          width={120}
          onChange={(font) => update((current) => selectUiFont(current, tone, font))}
        />
      </SettingRow>
    </SettingSection>
  )
}
