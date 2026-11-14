// 负责文件面板的原生菜单：文件树和文件工具栏的文件菜单、目录导航的工作目录菜单，以及文件标签的右键菜单。
// 没有原生菜单（浏览器预览）时不弹出，也不执行任何操作。
import { copyText, type MessageKey } from "@pigclaude/ui-primitives"
import { revealLabelKey } from "@pigclaude/ui-shell"
import type { WorkbenchBridge } from "../../../workbench-contract"
import { absoluteFilePath } from "./workbench-path"

type Point = { x: number; y: number }
type Translate = (key: MessageKey) => string

/** 菜单针对的条目；路径为空表示项目目录本身。 */
export type FileMenuEntry = { path: string; kind: "file" | "directory" }

/** 文件菜单交给文件面板执行的操作。 */
export type FileMenuActions = {
  onOpenFile: (path: string) => void
  onOpenFileTab: (path: string) => void
  onMention: (path: string) => void
}

/**
 * 弹出文件或目录的菜单：文件可以打开、在新标签打开、选编辑器打开、另存为；
 * 都可以在文件管理器中显示、复制路径；项目内的条目还能复制相对路径、@ 提及到输入框。
 */
export async function showFileMenu({
  bridge,
  root,
  entry,
  point,
  t,
  actions,
}: {
  bridge: WorkbenchBridge
  root: string
  entry: FileMenuEntry
  point: Point
  t: Translate
  actions: FileMenuActions
}): Promise<void> {
  const popup = window.pigcodeNative?.popupMenu
  if (!popup) return
  const file = entry.kind === "file"
  const absolute = entry.path ? absoluteFilePath(root, entry.path) : root
  const choice = await popup(
    [
      ...(file
        ? [
            { id: "open", label: t("files.menu.open") },
            { id: "open-tab", label: t("files.menu.openTab") },
            { id: "open-with", label: t("files.menu.openWith") },
            { id: "save-as", label: t("files.menu.saveAs") },
            { type: "separator" as const },
          ]
        : []),
      { id: "reveal", label: entry.path ? t("files.menu.reveal") : t(revealLabelKey()) },
      { id: "copy-path", label: t("files.menu.copyPath") },
      ...(entry.path
        ? [
            { id: "copy-relative", label: t("files.menu.copyRelativePath") },
            { type: "separator" as const },
            { id: "mention", label: t("files.menu.mention") },
          ]
        : []),
    ],
    point,
  )
  if (choice === "open") actions.onOpenFile(entry.path)
  else if (choice === "open-tab") actions.onOpenFileTab(entry.path)
  else if (choice === "mention") actions.onMention(entry.path)
  else if (choice === "reveal") await bridge.reveal(root, entry.path)
  else if (choice === "copy-path") await copyText(absolute)
  else if (choice === "copy-relative") await copyText(entry.path)
  else if (choice === "save-as") await bridge.saveAs(root, entry.path)
  else if (choice === "open-with") {
    const editors = await bridge.editors()
    const editor = await popup(
      [
        ...editors.map((item) => ({ id: item.id, label: item.name })),
        { id: "default-app", label: t("files.menu.defaultApp") },
      ],
      point,
    )
    if (editor === "default-app") await bridge.openFile(root, entry.path, null)
    else if (editor && editors.some((item) => item.id === editor)) {
      await bridge.openFile(root, entry.path, editor)
    }
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
