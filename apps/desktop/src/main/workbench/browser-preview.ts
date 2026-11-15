// 管理用户主动打开的独立本机预览窗口，以及它与工作台主窗口的归属。

import { BrowserWindow } from "electron"
import { randomUUID } from "node:crypto"
import {
  browserSession,
  configureContents,
  isWorkbenchLoopback,
  workbenchBrowserUrl,
} from "./browser-context"

/** 独立预览窗口沿用普通工作台沙箱和本机地址限制。 */
export class WorkbenchBrowserPreviews {
  readonly #owners = new Map<BrowserWindow, BrowserWindow>()

  /** 打开并显示指定主窗口的独立本机预览。 */
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
    this.#owners.set(preview, window)
    preview.once("closed", () => this.#owners.delete(preview))
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

  /** 关闭主窗口时同时关闭它打开的所有独立预览。 */
  closeWindow(window: BrowserWindow): void {
    for (const [preview, owner] of this.#owners) if (owner === window) preview.destroy()
  }
}
