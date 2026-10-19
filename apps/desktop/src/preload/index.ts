// 负责向渲染进程暴露桌面桥。只转发授权状态，不传递凭据。
import { contextBridge, ipcRenderer } from "electron"
import type { MembershipView } from "@pigclaude/contracts/membership"
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
  authorization: {
    start: (request: AuthorizationRequest) => Promise<AuthorizationStartResult>
    cancel: (sessionId: string) => Promise<AuthorizationStateEvent>
    subscribe: (listener: (event: AuthorizationStateEvent) => void) => () => void
  }
  membership: {
    inspect: () => Promise<MembershipView | null>
    signOut: () => Promise<MembershipView>
    subscribe: (listener: (view: MembershipView) => void) => () => void
  }
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
  onAuthorizationState: (listener) => subscribeAuthorization(listener),
  authorization: {
    start: (request) => ipcRenderer.invoke("pigclaude:authorization-start", request),
    cancel: (sessionId) => ipcRenderer.invoke("pigclaude:authorization-cancel", sessionId),
    subscribe: (listener) => subscribeAuthorization(listener),
  },
  membership: {
    inspect: () => ipcRenderer.invoke("pigclaude:membership-inspect"),
    signOut: () => ipcRenderer.invoke("pigclaude:membership-sign-out"),
    subscribe: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, value: MembershipView) => listener(value)
      ipcRenderer.on("pigclaude:membership-state", handler)
      void ipcRenderer.invoke("pigclaude:membership-subscribe").then((value: unknown) => {
        if (isMembershipView(value)) listener(value)
      })
      return () => ipcRenderer.removeListener("pigclaude:membership-state", handler)
    },
  },
}

function subscribeAuthorization(listener: (event: AuthorizationStateEvent) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, value: AuthorizationStateEvent) =>
    listener(value)
  ipcRenderer.on("pigclaude:authorization-state", handler)
  return () => ipcRenderer.removeListener("pigclaude:authorization-state", handler)
}

contextBridge.exposeInMainWorld("pigclaude", bridge)

function isMembershipView(value: unknown): value is MembershipView {
  return (
    typeof value === "object" &&
    value !== null &&
    "state" in value &&
    typeof value.state === "string" &&
    "startupPhase" in value
  )
}
