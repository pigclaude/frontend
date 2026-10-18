// 负责外观页所有对话框的开关和确认后的动作：导入、另存为、重命名、删除我的主题，以及重置为默认设置。
import type { AppearanceController } from "../../../hooks/use-appearance"
import { resetAppearance } from "../../../models/appearance-settings"
import {
  adoptSavedTheme,
  bakeTheme,
  forgetTheme,
  selectTheme,
  shownColors,
  type Tone,
} from "../../../models/theme-editing"
import { prepareCustomTheme, uniqueThemeName } from "../../../models/theme-library"
import { builtInThemes, type ThemeDefinition } from "../../../models/theme-presets"
import { ConfirmDialog } from "./confirm-dialog"
import { ThemeImportDialog } from "./theme-import-dialog"
import { ThemeNameDialog } from "./theme-name-dialog"

/** 外观页当前打开的对话框；null 表示都关着。 */
export type ThemeDialog =
  | { kind: "import" }
  | { kind: "save" }
  | { kind: "rename"; theme: ThemeDefinition }
  | { kind: "remove"; theme: ThemeDefinition }
  | { kind: "reset" }
  | null

const makeId = () => crypto.randomUUID()

/** 渲染外观页的对话框。新主题的 id 与名字都经 prepareCustomTheme 去重，切换只作用于 tone 模式。 */
export function ThemeDialogs({
  appearance,
  tone,
  dialog,
  onClose,
}: {
  appearance: AppearanceController
  tone: Tone
  dialog: ThemeDialog
  onClose: () => void
}) {
  const { settings, customThemes, update } = appearance
  const allNames = [...builtInThemes, ...customThemes].map((theme) => theme.name)
  const current = shownColors(settings, customThemes, tone).theme
  const onOpenChange = (open: boolean) => {
    if (!open) onClose()
  }

  const addTheme = (theme: ThemeDefinition): ThemeDefinition => {
    const prepared = prepareCustomTheme(theme, customThemes, makeId)
    appearance.saveCustomTheme(prepared)
    return prepared
  }
  const importTheme = (theme: ThemeDefinition) => {
    const saved = addTheme(theme)
    update((next) => selectTheme(next, tone, saved.id))
  }
  const saveAs = (name: string) => {
    const colors = bakeTheme(settings, customThemes, tone)
    const saved = addTheme({ id: "", name, builtIn: false, ...colors })
    update((next) => adoptSavedTheme(next, tone, saved.id))
    onClose()
  }
  const rename = (theme: ThemeDefinition, name: string) => {
    const others = [...builtInThemes, ...customThemes].filter((item) => item.id !== theme.id)
    appearance.renameCustomTheme(
      theme.id,
      uniqueThemeName(
        name,
        others.map((item) => item.name),
      ),
    )
    onClose()
  }
  const remove = (theme: ThemeDefinition) => {
    appearance.removeCustomTheme(theme.id)
    update((next) => forgetTheme(next, theme.id))
    onClose()
  }

  return (
    <>
      <ThemeImportDialog
        open={dialog?.kind === "import"}
        existingNames={allNames}
        onOpenChange={onOpenChange}
        onImport={importTheme}
      />
      <ThemeNameDialog
        open={dialog?.kind === "save"}
        title="另存为自定义主题"
        description="当前主题和你的修改会保存到「我的主题」，然后切换过去。"
        confirmLabel="保存"
        initialName={`${current.name} 副本`}
        onOpenChange={onOpenChange}
        onConfirm={saveAs}
      />
      <ThemeNameDialog
        open={dialog?.kind === "rename"}
        title="重命名主题"
        description="名字最多 40 个字符，重名时自动加序号。"
        confirmLabel="重命名"
        initialName={dialog?.kind === "rename" ? dialog.theme.name : ""}
        onOpenChange={onOpenChange}
        onConfirm={(name) => dialog?.kind === "rename" && rename(dialog.theme, name)}
      />
      <ConfirmDialog
        open={dialog?.kind === "remove"}
        title={dialog?.kind === "remove" ? `删除「${dialog.theme.name}」？` : "删除主题？"}
        description="正在使用它的模式会换回 pigclaude。这一步无法撤销。"
        confirmLabel="删除"
        danger
        onOpenChange={onOpenChange}
        onConfirm={() => dialog?.kind === "remove" && remove(dialog.theme)}
      />
      <ConfirmDialog
        open={dialog?.kind === "reset"}
        title="重置外观设置？"
        description="本页所有设置回到默认值。「我的主题」会保留。"
        confirmLabel="重置"
        onOpenChange={onOpenChange}
        onConfirm={() => {
          update(resetAppearance)
          onClose()
        }}
      />
    </>
  )
}
