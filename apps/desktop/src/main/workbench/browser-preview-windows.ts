// 管理工作台独立预览窗口及其受信主窗口的关闭关系。

import { randomUUID } from "node:crypto"
import { BrowserWindow } from "electron"
import {
  browserSession,
  configureContents,
  isWorkbenchLoopback,
  workbenchBrowserUrl,
} from "./browser-context"

/** 在独立窗口预览回环地址，并随打开预览的主窗口关闭。 */
export class WorkbenchBrowserPreviews {
  readonly #previews = new Map<BrowserWindow, BrowserWindow>()

  /** 在独立沙箱窗口预览本机开发地址。 */
  async open(window: BrowserWindow, input: unknown): Promise<{ id: string }> {
    const url = workbenchBrowserUrl(input)
    if (!isWorkbenchLoopback(url)) throw new Error("PREVIEW_URL_NOT_ALLOWED")
    const preview = new BrowserWindow({
      width: 1100,
      height: 760,
      show: false,
      webPreferences: {
        session: browserSession(),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })
    this.#previews.set(preview, window)
    preview.once("closed", () => this.#previews.delete(preview))
    configureContents(preview.webContents, true)
    try {
      await preview.loadURL(url.href)
      preview.show()
      return { id: randomUUID() }
    } catch {
      if (!preview.isDestroyed()) preview.destroy()
      throw new Error("WORKBENCH_PREVIEW_FAILED")
    }
  }

  /** 销毁这个主窗口打开的全部预览。 */
  closeWindow(window: BrowserWindow): void {
    for (const [preview, owner] of this.#previews) if (owner === window) preview.destroy()
  }
}
