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
import type {
  ClaudeModel,
  SessionBridge,
  SessionHostEvent,
  SessionStatusView,
  UsageBridge,
  UsageSummary,
} from "../main/session/session-types"

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
  session: SessionBridge
  usage: UsageBridge
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
  session: {
    start: async (input) => {
      const value: unknown = await ipcRenderer.invoke("pigclaude:session-start", input)
      if (!isRecord(value) || typeof value.sessionId !== "string") {
        throw new Error("INVALID_SESSION_RESPONSE")
      }
      return { sessionId: value.sessionId }
    },
    send: (input) => ipcRenderer.invoke("pigclaude:session-send", input),
    cancel: () => ipcRenderer.invoke("pigclaude:session-cancel"),
    respondPermission: (input) => ipcRenderer.invoke("pigclaude:session-respond-permission", input),
    setMode: (mode) => ipcRenderer.invoke("pigclaude:session-set-mode", mode),
    setModel: (model) => ipcRenderer.invoke("pigclaude:session-set-model", model),
    stop: () => ipcRenderer.invoke("pigclaude:session-stop"),
    models: async () => {
      const value: unknown = await ipcRenderer.invoke("pigclaude:session-models")
      return Array.isArray(value) ? value.filter(isClaudeModel) : []
    },
    status: async () => {
      const value: unknown = await ipcRenderer.invoke("pigclaude:session-status")
      if (!isSessionStatus(value)) throw new Error("INVALID_SESSION_STATUS")
      return value
    },
    subscribe: (listener) => subscribeSession(listener),
  },
  usage: {
    summary: async (input) => {
      const value: unknown = await ipcRenderer.invoke("pigclaude:usage-summary", input)
      if (!isUsageSummary(value)) throw new Error("INVALID_USAGE_SUMMARY")
      return value
    },
  },
}

function subscribeAuthorization(listener: (event: AuthorizationStateEvent) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, value: AuthorizationStateEvent) =>
    listener(value)
  ipcRenderer.on("pigclaude:authorization-state", handler)
  return () => ipcRenderer.removeListener("pigclaude:authorization-state", handler)
}

function subscribeSession(listener: (event: SessionHostEvent) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, value: unknown) => {
    if (isSessionEvent(value)) listener(value)
  }
  ipcRenderer.on("pigclaude:session-event", handler)
  return () => ipcRenderer.removeListener("pigclaude:session-event", handler)
}

const sessionEventTypes = new Set([
  "started",
  "delta",
  "message",
  "tool-result",
  "permission",
  "account-switched",
  "result",
  "error",
  "ended",
])

function isSessionEvent(value: unknown): value is SessionHostEvent {
  return isRecord(value) && typeof value.type === "string" && sessionEventTypes.has(value.type)
}

function isSessionStatus(value: unknown): value is SessionStatusView {
  return (
    isRecord(value) &&
    typeof value.active === "boolean" &&
    (value.sessionId === null || typeof value.sessionId === "string") &&
    (value.model === null || typeof value.model === "string") &&
    typeof value.permissionMode === "string" &&
    (value.accountId === null || typeof value.accountId === "string") &&
    typeof value.pendingPermissions === "number" &&
    Number.isFinite(value.pendingPermissions) &&
    (value.turnId === null || typeof value.turnId === "string")
  )
}

function isClaudeModel(value: unknown): value is ClaudeModel {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.displayName === "string" &&
    typeof value.description === "string" &&
    typeof value.isDefault === "boolean"
  )
}

function isUsageSummary(value: unknown): value is UsageSummary {
  if (!isRecord(value)) return false
  return [
    value.requests,
    value.inputTokens,
    value.outputTokens,
    value.cacheReadTokens,
    value.cacheCreationTokens,
    value.averageDurationMs,
    value.errors,
  ].every((item) => typeof item === "number" && Number.isFinite(item))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
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
