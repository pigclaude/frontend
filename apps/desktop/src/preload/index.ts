// 负责向渲染进程暴露桌面桥。只转发授权状态，不传递凭据。
import { contextBridge, ipcRenderer } from "electron"
import type { BrowserProfilesBridge } from "@pigclaude/contracts/browser-profile"
import { browserProfilesBridge } from "./browser-profiles"
import { isSessionEnvelope } from "./session-event-filter"
import { isSessionSummary } from "./session-summary-filter"
import { sessionHistoryBridge } from "./session-history"
import { projectPermissionsBridge } from "./project-permissions"
import { sessionDefaultsBridge, type SessionDefaultsBridge } from "./session-defaults"
import { windowBridge, type WindowBridge } from "./window-bridge"
import { workbenchBridge } from "./workbench"
import { updatesBridge, type UpdatesBridge } from "./updates"
import type { WorkbenchBridge } from "../workbench-contract"
import type { AuthorizeClaudeAccountInput } from "../main/claude/account-service-inputs"
import type { OpenAppKind } from "../main/workbench/open-apps"
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
  SessionEnvelope,
  SessionStatusView,
  UsageBridge,
  UsageSummary,
} from "../main/session/session-types"

/** 渲染进程能看到的桌面能力。不含凭据。 */
export type PigclaudeBridge = {
  browserProfiles?: BrowserProfilesBridge
  platform: string
  /** 系统版本，例如 Windows 的 10.0.22631；判断有没有可用的磨砂材质。 */
  systemVersion: string
  window: WindowBridge
  workbench?: WorkbenchBridge
  updates?: UpdatesBridge
  /** 读取当前发布版本、本机数据目录和实际使用的 Claude Code 版本，设置页只展示真实运行时信息。 */
  appInfo?: () => Promise<AppInfo>
  openExternal: (url: string) => Promise<void>
  setTheme: (source: "light" | "dark" | "system") => Promise<void>
  setDockIcon: (dataUrl: string) => Promise<void>
  pickFolder: (labels?: { title?: string; buttonLabel?: string }) => Promise<string | null>
  startAuthorization: (request: AuthorizationRequest) => Promise<AuthorizationStartResult>
  cancelAuthorization: (sessionId: string) => Promise<AuthorizationStateEvent>
  onAuthorizationState: (listener: (event: AuthorizationStateEvent) => void) => () => void
  authorization: {
    start: (request: AuthorizationRequest) => Promise<AuthorizationStartResult>
    cancel: (sessionId: string) => Promise<AuthorizationStateEvent>
    subscribe: (listener: (event: AuthorizationStateEvent) => void) => () => void
  }
  membership: {
    /** 只传当前界面的关联上下文，网站地址由主进程构造。 */
    openWebsite?: (contextId: string) => Promise<void>
    inspect: () => Promise<MembershipView | null>
    signOut: () => Promise<MembershipView>
    /** 只从当前主进程界面关联准备短期确认。 */
    prepareWithdrawal: (
      contextId: string,
    ) => Promise<import("@pigclaude/contracts/desktop-membership").DeviceWithdrawalConfirmation>
    /** 消费主进程确认，不接收自报身份。 */
    withdraw: (confirmationId: string) => Promise<MembershipView>
    subscribe: (listener: (view: MembershipView) => void) => () => void
  }
  claudeAccounts: {
    list: () => Promise<ClaudeAccountView[]>
    authorize: (input: AuthorizeClaudeAccountInput) => Promise<ClaudeAccountView>
    cancelAuthorization: () => Promise<void>
    update: (input: {
      accountId: string
      browserProfileId?: string
      displayName?: string
      enabled?: boolean
      proxyId?: string | null
      fingerprint?: ClaudeFingerprintView
    }) => Promise<ClaudeAccountView>
    remove: (accountId: string) => Promise<void>
    importFromClaudeCli: (input: {
      confirmCopy: boolean
      displayName?: string
      browserProfileId?: string | undefined
    }) => Promise<ClaudeAccountView>
    subscribe: (listener: (event: ClaudeAccountEvent) => void) => () => void
  }
  proxies: {
    list: () => Promise<ProxyView[]>
    save: (input: { id?: string; name: string; url: string }) => Promise<ProxyView>
    saveVerified?: (input: { name: string; url: string }) => Promise<ProxyView>
    remove: (id: string) => Promise<void>
    test: (id: string) => Promise<ProxyView>
  }
  egress: {
    check: (proxyId: string) => Promise<EgressView>
  }
  workspaces: {
    list: () => Promise<string[]>
    /** 只列出仍可读的最近项目，用于选择续接失败后的草稿目录。 */
    available?: () => Promise<string[]>
    /** 工作台登记的 worktree 归属，供会话侧栏恢复项目分组。 */
    worktreeProjects?: () => Promise<Record<string, string>>
    add: (path: string) => Promise<string[]>
    /** 只读列出工作区里的文件，供输入区 @ 引用。 */
    files: (path: string) => Promise<string[]>
    /** 侧栏项目的显示名，按工作区路径；没改过名的项目不出现。 */
    names: () => Promise<Record<string, string>>
    /** 只改侧栏显示名，返回全部显示名。 */
    rename: (path: string, name: string) => Promise<Record<string, string>>
    /** 从侧栏移除项目，不删除文件；返回移除后的工作区列表。 */
    remove: (path: string) => Promise<string[]>
    /** 在系统文件管理器里显示项目文件夹。 */
    reveal: (path: string) => Promise<void>
    /** 本机装了的文件管理器、编辑器和终端。 */
    apps: () => Promise<OpenAppView[]>
    /** 用本机应用打开项目文件夹。 */
    openWith: (path: string, appId: string) => Promise<void>
  }
  session: SessionBridge
  /** 新会话的默认模型、默认权限和选号偏好，存在本机。 */
  sessionDefaults: SessionDefaultsBridge
  usage: UsageBridge
}

/** 设置页展示的运行时信息；claudeCodeVersion 读不到时为 null。 */
export type AppInfo = {
  appVersion: string
  userDataPath: string
  claudeCodeVersion: string | null
}

const bridge: PigclaudeBridge = {
  browserProfiles: browserProfilesBridge(),
  platform: process.platform,
  systemVersion:
    typeof process.getSystemVersion === "function" ? process.getSystemVersion() : "unknown",
  window: windowBridge(),
  workbench: workbenchBridge(),
  updates: updatesBridge(),
  appInfo: () => ipcRenderer.invoke("pigclaude:app-info"),
  openExternal: (url) => ipcRenderer.invoke("pigclaude:open-external", url),
  setTheme: (source) => ipcRenderer.invoke("pigclaude:set-theme", source),
  setDockIcon: (dataUrl) => ipcRenderer.invoke("pigclaude:set-dock-icon", dataUrl),
  pickFolder: (labels) => ipcRenderer.invoke("pigclaude:pick-folder", labels),
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
    openWebsite: (contextId) => ipcRenderer.invoke("pigclaude:membership-open-website", contextId),
    inspect: () => ipcRenderer.invoke("pigclaude:membership-inspect"),
    signOut: () => ipcRenderer.invoke("pigclaude:membership-sign-out"),
    prepareWithdrawal: (contextId) =>
      ipcRenderer.invoke("pigclaude:membership-prepare-withdrawal", contextId),
    withdraw: (confirmationId) =>
      ipcRenderer.invoke("pigclaude:membership-withdraw", confirmationId),
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
    importFromClaudeCli: async (input) => {
      const value: unknown = await ipcRenderer.invoke("pigclaude:claude-accounts-import-cli", input)
      if (!isClaudeAccountView(value)) throw new Error("INVALID_CLAUDE_ACCOUNT_RESPONSE")
      return value
    },
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
    saveVerified: async (input) => {
      const value: unknown = await ipcRenderer.invoke("pigclaude:proxies-save-verified", input)
      if (!isProxyView(value) || value.lastTest?.ok !== true || value.lastTest.ip === null)
        throw new Error("INVALID_PROXY_RESPONSE")
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
  workspaces: {
    list: async () => {
      const value: unknown = await ipcRenderer.invoke("pigclaude:workspaces-list")
      return Array.isArray(value) ? value.filter(isWorkspacePath) : []
    },
    available: async () => {
      const value: unknown = await ipcRenderer.invoke("pigclaude:workspaces-available")
      return Array.isArray(value) ? value.filter(isWorkspacePath) : []
    },
    worktreeProjects: async () => {
      const projects = projectNames(
        await ipcRenderer.invoke("pigclaude:workspaces-worktree-projects"),
      )
      return Object.fromEntries(
        Object.entries(projects).filter(
          ([path, project]) => isWorkspacePath(path) && isWorkspacePath(project),
        ),
      )
    },
    add: async (path) => {
      const value: unknown = await ipcRenderer.invoke("pigclaude:workspaces-add", path)
      return Array.isArray(value) ? value.filter(isWorkspacePath) : []
    },
    files: async (path) => {
      const value: unknown = await ipcRenderer.invoke("pigclaude:workspaces-files", path)
      return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string")
        : []
    },
    names: async () => projectNames(await ipcRenderer.invoke("pigclaude:projects-names")),
    rename: async (path, name) =>
      projectNames(await ipcRenderer.invoke("pigclaude:projects-rename", path, name)),
    remove: async (path) => {
      const value: unknown = await ipcRenderer.invoke("pigclaude:projects-remove", path)
      return Array.isArray(value) ? value.filter(isWorkspacePath) : []
    },
    reveal: async (path) => {
      await ipcRenderer.invoke("pigclaude:projects-reveal", path)
    },
    apps: async () => {
      const value: unknown = await ipcRenderer.invoke("pigclaude:projects-apps")
      return Array.isArray(value) ? value.filter(isOpenAppView) : []
    },
    openWith: async (path, appId) => {
      await ipcRenderer.invoke("pigclaude:projects-open-with", path, appId)
    },
  },
  session: {
    projectPermissions: projectPermissionsBridge(),
    start: async (input) => {
      const value: unknown = await ipcRenderer.invoke("pigclaude:session-start", input)
      if (!isRecord(value) || typeof value.sessionId !== "string") {
        throw new Error("INVALID_SESSION_RESPONSE")
      }
      return { sessionId: value.sessionId }
    },
    send: (input) => ipcRenderer.invoke("pigclaude:session-send", input),
    cancel: (input) => ipcRenderer.invoke("pigclaude:session-cancel", input),
    respondPermission: (input) => ipcRenderer.invoke("pigclaude:session-respond-permission", input),
    answerQuestion: (input) => ipcRenderer.invoke("pigclaude:session-answer-question", input),
    setMode: (input) => ipcRenderer.invoke("pigclaude:session-set-mode", input),
    setModel: (input) => ipcRenderer.invoke("pigclaude:session-set-model", input),
    stop: (input) => ipcRenderer.invoke("pigclaude:session-stop", input),
    events: async (input) => {
      const value: unknown = await ipcRenderer.invoke("pigclaude:session-events", input)
      if (!Array.isArray(value) || !value.every(isSessionEnvelope)) {
        throw new Error("INVALID_SESSION_RESPONSE")
      }
      return value
    },
    models: async () => {
      const value: unknown = await ipcRenderer.invoke("pigclaude:session-models")
      if (!isRecord(value) || !Array.isArray(value.models)) return { models: [], cliError: null }
      return {
        models: value.models.filter(isClaudeModel),
        cliError: typeof value.cliError === "string" ? value.cliError : null,
      }
    },
    status: async (input) => {
      const value: unknown =
        input === undefined
          ? await ipcRenderer.invoke("pigclaude:session-status")
          : await ipcRenderer.invoke("pigclaude:session-status", input)
      if (!isSessionStatus(value)) throw new Error("INVALID_SESSION_STATUS")
      return value
    },
    list: async (input) => {
      const value: unknown = await ipcRenderer.invoke("pigclaude:session-list", input)
      if (!Array.isArray(value) || !value.every(isSessionSummary)) {
        throw new Error("INVALID_SESSION_RESPONSE")
      }
      return value
    },
    ...sessionHistoryBridge(),
    subscribe: (listener) => subscribeSession(listener),
  },
  sessionDefaults: sessionDefaultsBridge(),
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

function subscribeSession(listener: (envelope: SessionEnvelope) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, value: unknown) => {
    if (isSessionEnvelope(value)) listener(value)
  }
  ipcRenderer.on("pigclaude:session-event", handler)
  return () => ipcRenderer.removeListener("pigclaude:session-event", handler)
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
    typeof value.pendingQuestions === "number" &&
    Number.isFinite(value.pendingQuestions) &&
    (value.turnId === null || typeof value.turnId === "string")
  )
}

function isClaudeModel(value: unknown): value is ClaudeModel {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    (value.resolvedModel === undefined || typeof value.resolvedModel === "string") &&
    typeof value.displayName === "string" &&
    typeof value.description === "string" &&
    typeof value.isDefault === "boolean" &&
    (value.efforts === undefined ||
      (Array.isArray(value.efforts) && value.efforts.every((item) => typeof item === "string"))) &&
    (value.fast === undefined || typeof value.fast === "boolean")
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

function isWorkspacePath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

/** 页面看到的本机应用：不含安装位置。 */
export type OpenAppView = { id: string; name: string; kind: OpenAppKind }

function isOpenAppView(value: unknown): value is OpenAppView {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    (value.kind === "file-manager" || value.kind === "editor" || value.kind === "terminal")
  )
}

function projectNames(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  )
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
