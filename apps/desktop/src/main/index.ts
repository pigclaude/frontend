// 负责创建桌面窗口、承接浏览器授权回调并保存主进程秘密。
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeImage,
  nativeTheme,
  powerMonitor,
  safeStorage,
  shell,
} from "electron"
import { join } from "node:path"
import { readFileSync } from "node:fs"
import type { MembershipView } from "@pigclaude/contracts/membership"
import type { ClaudeAccountEvent } from "@pigclaude/contracts/claude-account"
import { LocalStore } from "@pigclaude/local-store"
import { checkEgress } from "@pigclaude/login-gate/egress-check"
import { startProxyBridge } from "@pigclaude/login-gate/proxy-bridge"
import { createCallbackServer } from "./authorization/callback-server"
import { AuthorizationStartError, AuthorizationService } from "./authorization/service"
import type {
  AuthorizationRequest,
  AuthorizationStartResult,
  AuthorizationStateEvent,
} from "./authorization/types"
import { isAllowedAuthorizationUrl } from "./authorization/url-policy"
import { ClaudeAccountService } from "./claude/account-service"
import { ClaudeAccountError } from "./claude/errors"
import { FingerprintChromiumAdapter } from "./claude/fingerprint-chromium"
import { registerClaudeIpc } from "./claude/ipc"
import { ProxyService } from "./claude/proxy-service"
import { SubscriptionOAuth } from "./claude/subscription-oauth"
import { createDesktopComposition, type DesktopComposition } from "./composition"
import { DeviceIdentityService } from "./device-identity"
import { readDockIconDataUrl } from "./dock-icon"
import { configureRuntimeProfile } from "./runtime-profile"
import { readDesktopRuntimeEndpoints } from "./runtime-endpoints"
import { FileSecretVault } from "./secret-vault"
import {
  createMainWindowOptions,
  developmentRendererUrl,
  glassBackgroundColor,
  readThemeSource,
} from "./window-options"

const bundleMetadata: unknown = app.isPackaged
  ? JSON.parse(readFileSync(join(app.getAppPath(), "package.json"), "utf8"))
  : undefined
const { rustBaseUrl, authOrigin } = readDesktopRuntimeEndpoints(process.env, bundleMetadata)
const packagedRedirectUri = "pigclaude://authorize/callback"
const hasSingleInstanceLock = configureRuntimeProfile(app, process.env["PIGCLAUDE_USER_DATA"])
let mainWindow: BrowserWindow | null = null
let authorizationService: AuthorizationService | null = null
let authorizationSetupError: string | undefined
let desktopComposition: DesktopComposition | null = null
let claudeAccountService: ClaudeAccountService | null = null
let proxyService: ProxyService | null = null
let callbackServer: Awaited<ReturnType<typeof createCallbackServer>> | null = null
let pendingCallbackUrls: string[] = []
let cleanupLiveEvents = () => {}

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
      authorizationSetupError = errorMessage(error)
      console.error(authorizationSetupError)
    }
    createWindow()
    void desktopComposition?.membershipGate.inspect()
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

app.on("before-quit", () => {
  cleanupLiveEvents()
  void desktopComposition?.dispose()
  void claudeAccountService?.dispose()
  void callbackServer?.close()
})

function registerIpcHandlers(): void {
  ipcMain.handle("pigclaude:pick-folder", async () => {
    const options: Electron.OpenDialogOptions = {
      title: "选择项目文件夹",
      buttonLabel: "添加项目",
      properties: ["openDirectory", "createDirectory"],
    }
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  ipcMain.handle("pigclaude:set-theme", (_event, value: unknown) => {
    const source = readThemeSource(value)
    if (source) nativeTheme.themeSource = source
  })
  nativeTheme.on("updated", applyGlassBackground)
  ipcMain.handle("pigclaude:set-dock-icon", (_event, value: unknown) => {
    if (process.platform !== "darwin") return
    const dataUrl = readDockIconDataUrl(value)
    if (!dataUrl) return
    try {
      const image = nativeImage.createFromDataURL(dataUrl)
      if (!image.isEmpty()) app.dock?.setIcon(image)
    } catch (error: unknown) {
      console.error(errorMessage(error))
    }
  })
  ipcMain.handle("pigclaude:open-external", async (_event, value: unknown) => {
    if (typeof value !== "string" || !isAllowedAuthorizationUrl(value, authOrigin)) return
    await shell.openExternal(value)
  })

  ipcMain.handle("pigclaude:membership-inspect", async () => {
    if (!desktopComposition) return null
    return desktopComposition.membershipGate.inspect()
  })
  ipcMain.handle("pigclaude:membership-subscribe", async () => {
    return desktopComposition?.membershipGate.view() ?? null
  })
  ipcMain.handle("pigclaude:membership-withdraw", async (event, value: unknown) => {
    if (
      !mainWindow ||
      event.sender !== mainWindow.webContents ||
      event.senderFrame !== mainWindow.webContents.mainFrame ||
      value !== undefined
    )
      throw new Error("UNTRUSTED_MEMBERSHIP_REQUEST")
    if (!desktopComposition) throw new Error("桌面授权服务尚未准备好")
    return desktopComposition.membershipGate.revoke()
  })
  ipcMain.handle("pigclaude:membership-sign-out", async () => {
    if (!desktopComposition) throw new Error("桌面授权服务尚未准备好")
    pendingCallbackUrls = []
    return desktopComposition.signOut()
  })

  ipcMain.handle("pigclaude:authorization-start", async (event, value: unknown) => {
    const request = readAuthorizationRequest(value)
    if (!request || !authorizationService || !callbackServer) {
      const result: AuthorizationStartResult = {
        ok: false,
        status: "network-error",
        error: authorizationSetupError ?? "授权服务尚未准备好",
      }
      return result
    }
    try {
      const redirectUri = app.isPackaged ? packagedRedirectUri : callbackServer.redirectUri
      const started = await authorizationService.start(request, redirectUri)
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
      if (!isAllowedAuthorizationUrl(started.authorizationUrl, authOrigin)) {
        throw new Error("授权地址不在 Rust 服务 allowlist 内")
      }
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

  registerClaudeIpc({
    getService: () => claudeAccountService,
    getProxyService: () => proxyService,
    isTrusted: isTrustedSender,
  })
}

async function setupAuthorization(): Promise<void> {
  const vault = new FileSecretVault(
    join(app.getPath("userData"), "authorization-secrets.json"),
    safeStorage,
  )
  const deviceIdentity = new DeviceIdentityService()
  await deviceIdentity.read()
  callbackServer = await createCallbackServer(handleCallbackUrl)
  const composition = createDesktopComposition({
    authOrigin,
    apiOptions: { baseUrl: rustBaseUrl, authorizationOrigin: authOrigin },
    vault,
    deviceIdentity,
    onMembershipView: sendMembershipView,
  })
  desktopComposition = composition
  authorizationService = composition.authorizationService

  const localStore = new LocalStore(join(app.getPath("userData"), "local"))
  const browser = new FingerprintChromiumAdapter({
    profilesRoot: join(app.getPath("userData"), "local", "browser-profiles"),
    binaryPath: process.env["PIGCLAUDE_FINGERPRINT_CHROMIUM_BIN"],
  })
  claudeAccountService = new ClaudeAccountService({
    store: localStore,
    browser,
    oauth: new SubscriptionOAuth(),
    startBridge: startProxyBridge,
    checkEgress,
    ensureMembership: async () => {
      const view = await composition.membershipGate.inspect()
      if (view.state !== "active") {
        throw new ClaudeAccountError("MEMBERSHIP_REQUIRED", "会员状态不可用")
      }
    },
    onEvent: sendClaudeAccountEvent,
  })
  proxyService = new ProxyService({ store: localStore })
  const checkLive = () => {
    void desktopComposition?.resume()
  }
  app.on("browser-window-focus", checkLive)
  powerMonitor.on("resume", checkLive)
  cleanupLiveEvents = () => {
    app.removeListener("browser-window-focus", checkLive)
    powerMonitor.removeListener("resume", checkLive)
  }
  if (app.isPackaged) app.setAsDefaultProtocolClient("pigclaude")
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

function sendMembershipView(view: MembershipView): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("pigclaude:membership-state", view)
  }
}

function sendClaudeAccountEvent(event: ClaudeAccountEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("pigclaude:claude-account-state", event)
  }
}

function isTrustedSender(event: Electron.IpcMainInvokeEvent): boolean {
  return (
    mainWindow !== null &&
    event.sender === mainWindow.webContents &&
    event.senderFrame === mainWindow.webContents.mainFrame
  )
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
  applyGlassBackground()
  mainWindow.once("ready-to-show", () => mainWindow?.show())
}

/** 外观变化时同步磨砂窗口的底色，深色下压暗系统材质。 */
function applyGlassBackground(): void {
  const color = glassBackgroundColor(process.platform, nativeTheme.shouldUseDarkColors)
  if (color) mainWindow?.setBackgroundColor(color)
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

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "授权服务不可用"
}
