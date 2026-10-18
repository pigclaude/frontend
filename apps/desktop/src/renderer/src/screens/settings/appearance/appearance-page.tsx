// 负责「外观」设置页：模式、主题分组、高级折叠区，以及导入导出和各个确认对话框。
import { useState } from "react"
import { useToast } from "../../../components/toast"
import type { AppearanceController } from "../../../hooks/use-appearance"
import { serializeTheme } from "../../../models/theme-file"
import { editTone, pigclaudeFallback, shownColors, type Tone } from "../../../models/theme-editing"
import { SettingPage, SettingRow, SettingSection } from "../setting-page"
import { AdvancedSettings } from "./advanced-settings"
import { ModePicker } from "./mode-picker"
import { ThemeDialogs, type ThemeDialog } from "./theme-dialogs"
import { ThemeGroup } from "./theme-group"

/** 渲染外观页。所有设置经 appearance.update 同步写入，立即生效并保存。 */
export function AppearancePage({ appearance }: { appearance: AppearanceController }) {
  const toast = useToast()
  const { settings, customThemes, resolved, update } = appearance
  const [editing, setEditing] = useState<Tone>(resolved)
  const [dialog, setDialog] = useState<ThemeDialog>(null)
  const tone = editTone(settings, resolved, editing)
  const glassAvailable = document.documentElement.dataset.glass === "true"
  const platform = window.pigclaude?.platform ?? ""

  const copyTheme = () => {
    const { theme } = shownColors(settings, customThemes, tone)
    const text = serializeTheme(theme, settings.overrides[theme.id], pigclaudeFallback)
    navigator.clipboard
      .writeText(text)
      .then(() => toast("已复制主题", "copy"))
      .catch(() => toast("复制失败，请重试", "alert"))
  }

  return (
    <SettingPage title="外观">
      <SettingSection title="视觉风格">
        <SettingRow title="模式">
          <ModePicker
            value={settings.mode}
            light={shownColors(settings, customThemes, "light").colors}
            dark={shownColors(settings, customThemes, "dark").colors}
            onChange={(mode) => update((current) => ({ ...current, mode }))}
          />
        </SettingRow>
      </SettingSection>
      <ThemeGroup
        appearance={appearance}
        tone={tone}
        onEditing={setEditing}
        onImport={() => setDialog({ kind: "import" })}
        onCopy={copyTheme}
        onSaveAs={() => setDialog({ kind: "save" })}
        onRename={(theme) => setDialog({ kind: "rename", theme })}
        onRemove={(theme) => setDialog({ kind: "remove", theme })}
      />
      <AdvancedSettings
        appearance={appearance}
        glassAvailable={glassAvailable}
        platform={platform}
        onReset={() => setDialog({ kind: "reset" })}
      />
      <ThemeDialogs
        appearance={appearance}
        tone={tone}
        dialog={dialog}
        onClose={() => setDialog(null)}
      />
    </SettingPage>
  )
}
