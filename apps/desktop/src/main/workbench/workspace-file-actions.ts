// 负责文件面板交给系统的操作：用外部编辑器或默认应用打开项目文件、另存为。
// 源文件必须是已登记项目里的普通文件，另存为的位置只来自用户在系统对话框里的选择。
import { randomUUID } from "node:crypto"
import { constants, createWriteStream } from "node:fs"
import { open, rename, unlink } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import { pipeline } from "node:stream/promises"
import { app, dialog, shell, type BrowserWindow } from "electron"
import { installedEditors, launchEditor } from "./installed-editors"
import { workspaceFileInfo, workspacePath } from "./workspace-path"

/** 用选中的编辑器打开项目里的文件，editor 为 null 时交给系统默认应用；编辑器不在本机时拒绝。 */
export async function openWorkbenchFile(
  root: string,
  path: string,
  editor: string | null,
): Promise<void> {
  const file = await workspacePath(root, path)
  await workspaceFileInfo(file)
  if (editor !== null) {
    const installed = installedEditors().find((item) => item.id === editor)
    if (!installed) throw new Error("WORKBENCH_APP_UNAVAILABLE")
    await launchEditor(installed, file)
    return
  }
  const error = await settleOpenPath(shell.openPath(file))
  if (error) throw new Error("WORKBENCH_OPEN_FAILED")
}

/** 弹出系统保存对话框（默认在下载目录），用户选定位置后复制文件；取消时返回 false。 */
export async function saveWorkbenchFileAs(
  window: BrowserWindow,
  root: string,
  path: string,
): Promise<boolean> {
  const file = await workspacePath(root, path)
  await workspaceFileInfo(file)
  const choice = await dialog.showSaveDialog(window, {
    defaultPath: join(app.getPath("downloads"), basename(file)),
    properties: ["createDirectory", "showOverwriteConfirmation"],
  })
  if (choice.canceled || !choice.filePath) return false
  await copyWorkbenchFile(root, path, choice.filePath)
  return true
}

/** 从不跟随链接的句柄读出源文件，先写到目标旁的临时文件再换上，目标就是源文件时也不会截断。 */
async function copyWorkbenchFile(root: string, path: string, destination: string): Promise<void> {
  const source = await workspacePath(root, path)
  const info = await workspaceFileInfo(source)
  const handle = await open(source, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  const temporary = join(
    dirname(destination),
    "." + basename(destination) + "." + randomUUID() + ".tmp",
  )
  try {
    const opened = await handle.stat()
    if (!opened.isFile() || opened.ino !== info.ino) throw new Error("WORKBENCH_FILE_CHANGED")
    await pipeline(
      handle.createReadStream({ start: 0, autoClose: false }),
      createWriteStream(temporary, { flags: "wx" }),
    )
    await rename(temporary, destination)
  } finally {
    await handle.close()
    await unlink(temporary).catch(() => undefined)
  }
}

/** Linux 的会话总线不可用时 openPath 可能一直不返回；超时就当作已经交给了系统。 */
function settleOpenPath(result: Promise<string>, waitMs = 1500): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<string>((resolve) => {
    timer = setTimeout(() => resolve(""), waitMs)
  })
  return Promise.race([result, timeout]).finally(() => clearTimeout(timer))
}
