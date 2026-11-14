// 负责文件面板的原生菜单：文件工具栏的「更多」菜单（打开方式、另存为）和文件标签的右键菜单。
// 没有原生菜单（浏览器预览）时不弹出，也不执行任何操作。
import type { MessageKey } from "@pigclaude/ui-primitives"
import type { WorkbenchBridge } from "../../../workbench-contract"

type Point = { x: number; y: number }
type Translate = (key: MessageKey) => string

/** 文件工具栏的「更多」菜单：选一个本机编辑器或系统默认应用打开，或者另存为。 */
export async function showFileMenu({
  bridge,
  root,
  path,
  point,
  t,
}: {
  bridge: WorkbenchBridge
  root: string
  path: string
  point: Point
  t: Translate
}): Promise<void> {
  const popup = window.pigcodeNative?.popupMenu
  if (!popup) return
  const choice = await popup(
    [
      { id: "open-with", label: t("files.menu.openWith") },
      { id: "save-as", label: t("files.menu.saveAs") },
    ],
    point,
  )
  if (choice === "save-as") {
    await bridge.saveAs(root, path)
    return
  }
  if (choice !== "open-with") return
  const editors = await bridge.editors()
  const editor = await popup(
    [
      ...editors.map((item) => ({ id: item.id, label: item.name })),
      { id: "default-app", label: t("files.menu.defaultApp") },
    ],
    point,
  )
  if (editor === "default-app") await bridge.openFile(root, path, null)
  else if (editor && editors.some((item) => item.id === editor)) {
    await bridge.openFile(root, path, editor)
  }
}

/** 文件标签右键菜单的选择：关闭这个标签、其他标签或全部标签。 */
export type FileTabChoice = "close" | "close-others" | "close-all"

/** 弹出文件标签的右键菜单；只有一个标签时「关闭其他标签」不可用。 */
export async function showFileTabMenu(
  point: Point,
  tabCount: number,
  t: Translate,
): Promise<FileTabChoice | null> {
  const popup = window.pigcodeNative?.popupMenu
  if (!popup) return null
  const choice = await popup(
    [
      { id: "close", label: t("files.tabs.close") },
      { id: "close-others", label: t("files.tabs.closeOthers"), enabled: tabCount > 1 },
      { id: "close-all", label: t("files.tabs.closeAll") },
    ],
    point,
  )
  return choice === "close" || choice === "close-others" || choice === "close-all" ? choice : null
}
