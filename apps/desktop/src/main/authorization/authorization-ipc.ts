// 负责浏览器授权的开始和取消 IPC：只在授权服务就绪时打开 allowlist 内的授权地址，失败时取消已开始的授权并回报状态。
import { ipcMain, shell } from "electron"
import { privateAuthorizationRedirectUri } from "./callback-receiver"
import { readAuthorizationRequest } from "./request-input"
import { AuthorizationStartError, type AuthorizationService } from "./service"
import type { AuthorizationStartResult, AuthorizationStateEvent } from "./types"
import { isAllowedAuthorizationUrl } from "./url-policy"
import { errorMessage } from "../error-message"

/** 授权 IPC 读取的主进程状态；都在调用时读取，初始化前后都能注册。 */
export type AuthorizationIpcOptions = {
  /** 授权服务和本机回调服务都就绪时返回它们，否则返回 null。 */
  ready: () => { service: AuthorizationService; redirectUri: string } | null
  /** 当前授权服务；取消时只要服务存在即可。 */
  service: () => AuthorizationService | null
  /** 初始化失败的原因，没有失败时为 undefined。 */
  setupError: () => string | undefined
  isPackaged: boolean
  authOrigin: string
  onState: (event: AuthorizationStateEvent) => void
}

/** 注册授权开始和取消。保证只打开 Rust 服务 allowlist 内的地址；打开失败时取消授权，除非已在提交。 */
export function registerAuthorizationIpc(options: AuthorizationIpcOptions): void {
  ipcMain.handle("pigclaude:authorization-start", async (event, value: unknown) => {
    const request = readAuthorizationRequest(value)
    const ready = options.ready()
    if (!request || !ready) {
      const result: AuthorizationStartResult = {
        ok: false,
        status: "network-error",
        error: options.setupError() ?? "授权服务尚未准备好",
      }
      return result
    }
    const authorizationService = ready.service
    let started: Awaited<ReturnType<AuthorizationService["start"]>> | null = null
    try {
      const redirectUri = options.isPackaged ? privateAuthorizationRedirectUri : ready.redirectUri
      started = await authorizationService.start(request, redirectUri)
      if (authorizationService.getActiveSession()?.sessionId !== started.sessionId) {
        throw new AuthorizationStartError("cancelled", "授权会话已取消")
      }
      const browserEvent: AuthorizationStateEvent = {
        sessionId: started.sessionId,
        purpose: request.purpose,
        mode: request.mode,
        status: "browser-open",
        authorizationUrl: started.authorizationUrl,
        expiresAt: started.expiresAt,
      }
      event.sender.send("pigclaude:authorization-state", browserEvent)
      if (!isAllowedAuthorizationUrl(started.authorizationUrl, options.authOrigin)) {
        throw new Error("授权地址不在 Rust 服务 allowlist 内")
      }
      await shell.openExternal(started.authorizationUrl)
      return { ok: true, ...started } satisfies AuthorizationStartResult
    } catch (error: unknown) {
      if (started) {
        const cancellation = await authorizationService.cancel(started.sessionId)
        if (cancellation.status === "committing")
          return { ok: true, ...started } satisfies AuthorizationStartResult
      }
      const status = error instanceof AuthorizationStartError ? error.status : "network-error"
      const result: AuthorizationStartResult = { ok: false, status, error: errorMessage(error) }
      event.sender.send("pigclaude:authorization-state", {
        purpose: request.purpose,
        mode: request.mode,
        sessionId: "",
        status,
        error: result.error,
      } satisfies AuthorizationStateEvent)
      return result
    }
  })

  ipcMain.handle("pigclaude:authorization-cancel", async (_event, sessionId: unknown) => {
    const authorizationService = options.service()
    if (!authorizationService || typeof sessionId !== "string") {
      return {
        sessionId: typeof sessionId === "string" ? sessionId : "",
        purpose: "pigclaude-login",
        mode: "login",
        status: "cancelled",
        error: "授权会话已结束",
      } satisfies AuthorizationStateEvent
    }
    const result = await authorizationService.cancel(sessionId)
    options.onState(result)
    return result
  })
}
