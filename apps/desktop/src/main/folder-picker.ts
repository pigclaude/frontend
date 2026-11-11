// 负责「添加项目」的系统文件夹选择框：校验页面按当前语言传来的文案，以主窗口为父弹出选择框。
import type { IpcMain, OpenDialogOptions, OpenDialogReturnValue } from "electron"

/** 选择框的标题与确认按钮文案。 */
export type FolderPickerLabels = { title?: string; buttonLabel?: string }

const MAX_LABEL = 80

/** 页面没传文案时用的默认文案。 */
export const defaultFolderPickerLabels = {
  title: "选择项目文件夹",
  buttonLabel: "添加项目",
} as const

/** 校验页面传来的文案；不合法的字段丢弃，换成默认文案，选择框照常打开。 */
export function readFolderPickerLabels(value: unknown): Required<FolderPickerLabels> {
  const labels: Required<FolderPickerLabels> = { ...defaultFolderPickerLabels }
  if (typeof value !== "object" || value === null) return labels
  const record = value as Record<string, unknown>
  for (const key of ["title", "buttonLabel"] as const) {
    const text = record[key]
    if (typeof text === "string" && text.length > 0 && text.length <= MAX_LABEL) labels[key] = text
  }
  return labels
}

/** 弹出系统选择框；有主窗口时以它为父窗口。 */
export type ShowFolderDialog = (options: OpenDialogOptions) => Promise<OpenDialogReturnValue>

/** 注册 pigclaude:pick-folder；返回选中的文件夹，取消时为 null。 */
export function registerFolderPickerIpc(
  ipcMain: Pick<IpcMain, "handle">,
  showDialog: ShowFolderDialog,
): void {
  ipcMain.handle("pigclaude:pick-folder", async (_event, labels: unknown) => {
    const result = await showDialog({
      properties: ["openDirectory", "createDirectory"],
      ...readFolderPickerLabels(labels),
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
}
