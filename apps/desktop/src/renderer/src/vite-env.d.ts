// 让 TypeScript 认识 Vite 注入的客户端类型，以及预加载暴露的桌面桥。
/// <reference types="vite/client" />

interface PigclaudeBridge {
  browserProfiles?: import("@pigclaude/contracts/browser-profile").BrowserProfilesBridge
  platform: string
  systemVersion?: string
  window?: import("../../preload/window-bridge").WindowBridge
  appInfo?: () => Promise<import("../../preload/index").AppInfo>
  openExternal?: (url: string) => Promise<void>
  setTheme?: (source: "light" | "dark" | "system") => Promise<void>
  setDockIcon?: (dataUrl: string) => Promise<void>
  pickFolder?: (labels?: { title?: string; buttonLabel?: string }) => Promise<string | null>
  startAuthorization?: (
    request: import("../../main/authorization/types").AuthorizationRequest,
  ) => Promise<import("../../main/authorization/types").AuthorizationStartResult>
  cancelAuthorization?: (
    sessionId: string,
  ) => Promise<import("../../main/authorization/types").AuthorizationStateEvent>
  onAuthorizationState?: (
    listener: (event: import("../../main/authorization/types").AuthorizationStateEvent) => void,
  ) => () => void
  authorization?: {
    start: (
      request: import("../../main/authorization/types").AuthorizationRequest,
    ) => Promise<import("../../main/authorization/types").AuthorizationStartResult>
    cancel: (
      sessionId: string,
    ) => Promise<import("../../main/authorization/types").AuthorizationStateEvent>
    subscribe: (
      listener: (event: import("../../main/authorization/types").AuthorizationStateEvent) => void,
    ) => () => void
  }
  membership?: {
    /** 主进程只为当前恢复界面生成固定网站办理入口。 */
    openWebsite?: (contextId: string) => Promise<void>
    inspect: () => Promise<import("@pigclaude/contracts/membership").MembershipView | null>
    signOut: () => Promise<import("@pigclaude/contracts/membership").MembershipView>
    prepareWithdrawal?: (
      contextId: string,
    ) => Promise<import("@pigclaude/contracts/desktop-membership").DeviceWithdrawalConfirmation>
    withdraw: (
      confirmationId: string,
    ) => Promise<import("@pigclaude/contracts/membership").MembershipView>
    subscribe: (
      listener: (view: import("@pigclaude/contracts/membership").MembershipView) => void,
    ) => () => void
  }
  claudeAccounts?: import("../../preload/index").PigclaudeBridge["claudeAccounts"]
  proxies?: import("../../preload/index").PigclaudeBridge["proxies"]
  egress?: import("../../preload/index").PigclaudeBridge["egress"]
  workspaces?: import("../../preload/index").PigclaudeBridge["workspaces"]
  workbench?: import("../../preload/index").PigclaudeBridge["workbench"]
  session?: import("../../preload/index").PigclaudeBridge["session"]
  sessionDefaults?: import("../../preload/index").PigclaudeBridge["sessionDefaults"]
  usage?: import("../../preload/index").PigclaudeBridge["usage"]
}

interface Window {
  pigclaude?: PigclaudeBridge
}
