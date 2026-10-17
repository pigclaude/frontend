// 让 TypeScript 认识 Vite 注入的客户端类型，以及预加载暴露的桌面桥。
/// <reference types="vite/client" />

interface PigclaudeBridge {
  platform: string
  openExternal?: (url: string) => Promise<void>
  setTheme?: (source: "light" | "dark" | "system") => Promise<void>
  pickFolder?: () => Promise<string | null>
  startAuthorization?: (
    request: import("../../main/authorization/types").AuthorizationRequest,
  ) => Promise<import("../../main/authorization/types").AuthorizationStartResult>
  cancelAuthorization?: (
    sessionId: string,
  ) => Promise<import("../../main/authorization/types").AuthorizationStateEvent>
  onAuthorizationState?: (
    listener: (event: import("../../main/authorization/types").AuthorizationStateEvent) => void,
  ) => () => void
}

interface Window {
  pigclaude?: PigclaudeBridge
}
