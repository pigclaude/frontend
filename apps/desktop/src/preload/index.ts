// 负责向渲染进程暴露桌面桥。只转发授权状态，不传递凭据。
import { contextBridge, ipcRenderer } from "electron"
import type {
  AuthorizationRequest,
  AuthorizationStartResult,
  AuthorizationStateEvent,
} from "../main/authorization/types"

/** 渲染进程能看到的桌面能力。不含凭据。 */
export type PigclaudeBridge = {
  platform: string
  openExternal: (url: string) => Promise<void>
  setTheme: (source: "light" | "dark" | "system") => Promise<void>
  setDockIcon: (dataUrl: string) => Promise<void>
  pickFolder: () => Promise<string | null>
  startAuthorization: (request: AuthorizationRequest) => Promise<AuthorizationStartResult>
  cancelAuthorization: (sessionId: string) => Promise<AuthorizationStateEvent>
  onAuthorizationState: (listener: (event: AuthorizationStateEvent) => void) => () => void
}

const bridge: PigclaudeBridge = {
  platform: process.platform,
  openExternal: (url) => ipcRenderer.invoke("pigclaude:open-external", url),
  setTheme: (source) => ipcRenderer.invoke("pigclaude:set-theme", source),
  setDockIcon: (dataUrl) => ipcRenderer.invoke("pigclaude:set-dock-icon", dataUrl),
  pickFolder: () => ipcRenderer.invoke("pigclaude:pick-folder"),
  startAuthorization: (request) => ipcRenderer.invoke("pigclaude:authorization-start", request),
  cancelAuthorization: (sessionId) =>
    ipcRenderer.invoke("pigclaude:authorization-cancel", sessionId),
  onAuthorizationState: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, value: AuthorizationStateEvent) =>
      listener(value)
    ipcRenderer.on("pigclaude:authorization-state", handler)
    return () => ipcRenderer.removeListener("pigclaude:authorization-state", handler)
  },
}

contextBridge.exposeInMainWorld("pigclaude", bridge)
