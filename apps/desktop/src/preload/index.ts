// 负责向渲染进程暴露桌面桥。只打开授权网页，不传递凭据。
import { contextBridge, ipcRenderer } from "electron"

/** 渲染进程能看到的桌面能力。不含凭据。 */
export type PigclaudeBridge = {
  platform: string
  openExternal: (url: string) => Promise<void>
}

const bridge: PigclaudeBridge = {
  platform: process.platform,
  openExternal: (url) => ipcRenderer.invoke("pigclaude:open-external", url),
}

contextBridge.exposeInMainWorld("pigclaude", bridge)
