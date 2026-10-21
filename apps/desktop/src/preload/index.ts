// 负责向渲染进程暴露桌面桥。只转发授权状态，不传递凭据。
import { contextBridge, ipcRenderer } from "electron"
import type { MembershipView } from "@pigclaude/contracts/membership"
import {
  isClaudeAccountEvent,
  isClaudeAccountView,
  isProxyView,
  type ClaudeAccountEvent,
  type ClaudeAccountView,
  type ClaudeFingerprintView,
  type EgressView,
  type ProxyView,
} from "@pigclaude/contracts/claude-account"
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
    /** 撤销当前可信 token 绑定的设备关系，不接收自报身份。 */
    withdraw: () => Promise<MembershipView>
    subscribe: (listener: (view: MembershipView) => void) => () => void
  }
  claudeAccounts: {
    list: () => Promise<ClaudeAccountView[]>
    authorize: (input: {
      accountId?: string
      displayName: string
      proxyId: string
      fingerprint: ClaudeFingerprintView
    }) => Promise<ClaudeAccountView>
    cancelAuthorization: () => Promise<void>
    update: (input: {
      accountId: string
      displayName?: string
      enabled?: boolean
      proxyId?: string
      fingerprint?: ClaudeFingerprintView
    }) => Promise<ClaudeAccountView>
    remove: (accountId: string) => Promise<void>
    subscribe: (listener: (event: ClaudeAccountEvent) => void) => () => void
  }
  proxies: {
    list: () => Promise<ProxyView[]>
    save: (input: { id?: string; name: string; url: string }) => Promise<ProxyView>
    remove: (id: string) => Promise<void>
    test: (id: string) => Promise<ProxyView>
  }
  egress: {
    check: (proxyId: string) => Promise<EgressView>
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
    withdraw: () => ipcRenderer.invoke("pigclaude:membership-withdraw"),
    subscribe: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, value: MembershipView) => listener(value)
      ipcRenderer.on("pigclaude:membership-state", handler)
      void ipcRenderer.invoke("pigclaude:membership-subscribe").then((value: unknown) => {
        if (isMembershipView(value)) listener(value)
      })
      return () => ipcRenderer.removeListener("pigclaude:membership-state", handler)
    },
  },
  claudeAccounts: {
    list: async () => {
      const value: unknown = await ipcRenderer.invoke("pigclaude:claude-accounts-list")
      return Array.isArray(value) ? value.filter(isClaudeAccountView) : []
    },
    authorize: async (input) => {
      const value: unknown = await ipcRenderer.invoke("pigclaude:claude-accounts-authorize", input)
      if (!isClaudeAccountView(value)) throw new Error("INVALID_CLAUDE_ACCOUNT_RESPONSE")
      return value
    },
    cancelAuthorization: () => ipcRenderer.invoke("pigclaude:claude-accounts-cancel"),
    update: async (input) => {
      const value: unknown = await ipcRenderer.invoke("pigclaude:claude-accounts-update", input)
      if (!isClaudeAccountView(value)) throw new Error("INVALID_CLAUDE_ACCOUNT_RESPONSE")
      return value
    },
    remove: (accountId) => ipcRenderer.invoke("pigclaude:claude-accounts-remove", accountId),
    subscribe: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, value: unknown) => {
        if (isClaudeAccountEvent(value)) listener(value)
      }
      ipcRenderer.on("pigclaude:claude-account-state", handler)
      return () => ipcRenderer.removeListener("pigclaude:claude-account-state", handler)
    },
  },
  proxies: {
    list: async () => {
      const value: unknown = await ipcRenderer.invoke("pigclaude:proxies-list")
      return Array.isArray(value) ? value.filter(isProxyView) : []
    },
    save: async (input) => {
      const value: unknown = await ipcRenderer.invoke("pigclaude:proxies-save", input)
      if (!isProxyView(value)) throw new Error("INVALID_PROXY_RESPONSE")
      return value
    },
    remove: (id) => ipcRenderer.invoke("pigclaude:proxies-remove", id),
    test: async (id) => {
      const value: unknown = await ipcRenderer.invoke("pigclaude:proxies-test", id)
      if (!isProxyView(value)) throw new Error("INVALID_PROXY_RESPONSE")
      return value
    },
  },
  egress: {
    check: (proxyId) => ipcRenderer.invoke("pigclaude:egress-check", proxyId),
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
