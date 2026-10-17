// 负责创建桌面窗口、承接浏览器授权回调并保存主进程秘密。
import { app, BrowserWindow, ipcMain, safeStorage, shell } from "electron"
import { join } from "node:path"
import { createCallbackServer } from "./authorization/callback-server"
import { AuthorizationStartError, AuthorizationService } from "./authorization/service"
import type {
  AuthorizationRequest,
  AuthorizationStartResult,
  AuthorizationStateEvent,
  AuthorizationToken,
} from "./authorization/types"
import { isAllowedAuthorizationUrl } from "./authorization/url-policy"
import { FileSecretVault } from "./secret-vault"
import { createMainWindowOptions, developmentRendererUrl } from "./window-options"

const authOrigin = process.env["PIGCLAUDE_AUTH_ORIGIN"] ?? "http://localhost:5173"
const packagedRedirectUri = "pigclaude://authorize/callback"
const hasSingleInstanceLock = app.requestSingleInstanceLock()
let mainWindow: BrowserWindow | null = null
let authorizationService: AuthorizationService | null = null
let callbackServer: Awaited<ReturnType<typeof createCallbackServer>> | null = null
let pendingCallbackUrls: string[] = []

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  registerIpcHandlers()
  app.on("open-url", (event, url) => {
    event.preventDefault()
    void handleCallbackUrl(url)
  })
  app.on("second-instance", (_event, commandLine) => {
    const callback = commandLine.find((value) => value.startsWith("pigclaude://authorize/callback"))
    if (callback) void handleCallbackUrl(callback)
    mainWindow?.show()
    mainWindow?.focus()
  })
  void app.whenReady().then(async () => {
    try {
      await setupAuthorization()
    } catch (error: unknown) {
      console.error(errorMessage(error))
    }
    createWindow()
    const callbacks = pendingCallbackUrls
    pendingCallbackUrls = []
    for (const url of callbacks) await handleCallbackUrl(url)
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})

function registerIpcHandlers(): void {
  ipcMain.handle("pigclaude:open-external", async (_event, value: unknown) => {
    if (typeof value !== "string" || !isAllowedAuthorizationUrl(value, authOrigin)) return
    await shell.openExternal(value)
  })

  ipcMain.handle("pigclaude:authorization-start", async (event, value: unknown) => {
    const request = readAuthorizationRequest(value)
    if (!request || !authorizationService || !callbackServer) {
      const result: AuthorizationStartResult = {
        ok: false,
        status: "network-error",
        error: "授权服务尚未准备好",
      }
      return result
    }
    try {
      const redirectUri = app.isPackaged ? packagedRedirectUri : callbackServer.redirectUri
      const started = await authorizationService.start(request, redirectUri)
      const browserEvent: AuthorizationStateEvent = {
        sessionId: started.sessionId,
        purpose: request.purpose,
        mode: request.mode,
        status: "browser-open",
        authorizationUrl: started.authorizationUrl,
        expiresAt: started.expiresAt,
      }
      event.sender.send("pigclaude:authorization-state", browserEvent)
      await shell.openExternal(started.authorizationUrl)
      return { ok: true, ...started } satisfies AuthorizationStartResult
    } catch (error: unknown) {
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
    sendAuthorizationState(result)
    return result
  })
}

async function setupAuthorization(): Promise<void> {
  const vault = new FileSecretVault(
    join(app.getPath("userData"), "authorization-secrets.json"),
    safeStorage,
  )
  callbackServer = await createCallbackServer(handleCallbackUrl)
  authorizationService = new AuthorizationService({
    authOrigin,
    vault,
    exchangeCode: exchangeAuthorizationCode,
  })
  if (app.isPackaged) app.setAsDefaultProtocolClient("pigclaude")
}

async function exchangeAuthorizationCode(input: {
  code: string
  codeVerifier: string
  redirectUri: string
  clientId: string
  session: AuthorizationService["getActiveSession"] extends () => infer T ? Exclude<T, null> : never
}): Promise<AuthorizationToken> {
  const response = await fetch(`${authOrigin}/authorize/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      code: input.code,
      codeVerifier: input.codeVerifier,
      redirectUri: input.redirectUri,
      clientId: input.clientId,
    }),
  })
  const body: unknown = await response.json().catch(() => undefined)
  if (!response.ok) throw new Error(readError(body) ?? "授权码交换失败")
  return readAuthorizationToken(body, input.session)
}

async function handleCallbackUrl(url: string): Promise<void> {
  if (!authorizationService) {
    pendingCallbackUrls.push(url)
    return
  }
  const session = authorizationService.getActiveSession()
  if (session) {
    sendAuthorizationState({
      sessionId: session.sessionId,
      purpose: session.request.purpose,
      mode: session.request.mode,
      status: "exchanging",
      expiresAt: session.expiresAt,
    })
  }
  const result = await authorizationService.handleCallback(url)
  sendAuthorizationState(result)
  mainWindow?.show()
  mainWindow?.focus()
}

function sendAuthorizationState(event: AuthorizationStateEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("pigclaude:authorization-state", event)
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow(
    createMainWindowOptions({
      platform: process.platform,
      preloadPath: join(__dirname, "../preload/index.js"),
      isPackaged: app.isPackaged,
    }),
  )
  const devRendererUrl = developmentRendererUrl(
    app.isPackaged,
    process.env["ELECTRON_RENDERER_URL"],
  )
  if (devRendererUrl) {
    void mainWindow.loadURL(devRendererUrl)
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"))
  }
  mainWindow.once("ready-to-show", () => mainWindow?.show())
}

function readAuthorizationRequest(value: unknown): AuthorizationRequest | null {
  if (!isRecord(value)) return null
  const purpose = value.purpose
  const mode = value.mode
  if (
    (purpose !== "pigclaude-login" && purpose !== "claude-account") ||
    (mode !== "login" && mode !== "register" && mode !== "authorize")
  ) {
    return null
  }
  return {
    purpose,
    mode,
    accountName: readOptionalString(value.accountName),
    proxyId: readOptionalString(value.proxyId),
    fingerprintSeed: readOptionalString(value.fingerprintSeed),
    bridgeExit: readOptionalString(value.bridgeExit),
    daemonExit: readOptionalString(value.daemonExit),
  }
}

function readAuthorizationToken(
  value: unknown,
  session: NonNullable<ReturnType<AuthorizationService["getActiveSession"]>>,
): AuthorizationToken {
  if (!isRecord(value)) throw new Error("授权响应格式无效")
  const accessToken = readString(value.accessToken ?? value.access_token)
  const refreshToken = readString(value.refreshToken ?? value.refresh_token)
  const accountId = readString(value.accountId ?? value.account_id)
  const displayName = readString(value.displayName ?? value.display_name)
  const expiresAt = typeof value.expiresAt === "number" ? value.expiresAt : Date.now() + 3_600_000
  const credential = readOptionalString(value.credential)
  return {
    accessToken,
    refreshToken,
    accountId,
    displayName,
    expiresAt,
    credential,
    purpose: session.request.purpose,
    mode: session.request.mode,
  }
}

function readString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) throw new Error("授权响应缺少字段")
  return value
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function readError(value: unknown): string | null {
  return isRecord(value) && typeof value.error === "string" ? value.error : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "授权服务不可用"
}
