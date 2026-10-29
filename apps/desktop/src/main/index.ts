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
  screen,
  shell,
} from "electron"
import { join } from "node:path"
import { readFileSync } from "node:fs"
import type { MembershipView } from "@pigclaude/contracts/membership"
import { isAccountSelectable, type ClaudeAccountEvent } from "@pigclaude/contracts/claude-account"
import { LocalStore } from "@pigclaude/local-store"
import { checkEgress } from "@pigclaude/login-gate/egress-check"
import { startProxyBridge } from "@pigclaude/login-gate/proxy-bridge"
import { createCallbackServer } from "./authorization/callback-server"
import {
  createAuthorizationCallbackReceiver,
  privateAuthorizationRedirectUri,
  type AuthorizationCallbackReceiver,
} from "./authorization/callback-receiver"
import { AuthorizationStartError, AuthorizationService } from "./authorization/service"
import type { AuthorizationStartResult, AuthorizationStateEvent } from "./authorization/types"
import { readAuthorizationRequest } from "./authorization/request-input"
import { isAllowedAuthorizationUrl } from "./authorization/url-policy"
import { ClaudeAccountService } from "./claude/account-service"
import { ClaudeAccountError } from "./claude/errors"
import { FingerprintChromiumAdapter } from "./claude/fingerprint-chromium"
import { registerClaudeIpc } from "./claude/ipc"
import { ProxyService } from "./claude/proxy-service"
import { SubscriptionOAuth } from "./claude/subscription-oauth"
import { createDesktopComposition, type DesktopComposition } from "./composition"
import { DeviceIdentityService } from "./device-identity"
import { readDeviceInfo } from "./device-identity/device-info"
import { readDockIconDataUrl } from "./dock-icon"
import { configureRuntimeProfile } from "./runtime-profile"
import { registerMembershipIpc } from "./membership/ipc"
import { readDesktopRuntimeEndpoints } from "./runtime-endpoints"
import { WorkspaceStore } from "./runtime/workspace-store"
import { resolveClaudeBinaryPath } from "./session/claude-binary"
import { cleanupStaleSessionDirs } from "./session/session-environment"
import { SessionHost } from "./session/session-host"
import { registerSessionIpc } from "./session/session-ipc"
import { createQuitCoordinator } from "./shutdown"
import type { SessionHostEvent } from "./session/session-types"
import { UsageRecorder } from "./session/usage-recorder"
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
const { rustBaseUrl, authOrigin, websiteOrigin } = readDesktopRuntimeEndpoints(
  process.env,
  bundleMetadata,
)
const hasSingleInstanceLock = configureRuntimeProfile(app, process.env["PIGCLAUDE_USER_DATA"])
let mainWindow: BrowserWindow | null = null
let authorizationService: AuthorizationService | null = null
let authorizationSetupError: string | undefined
let desktopComposition: DesktopComposition | null = null
let claudeAccountService: ClaudeAccountService | null = null
let proxyService: ProxyService | null = null
let sessionHost: SessionHost | null = null
let usageRecorder: UsageRecorder | null = null
let workspaceStore: WorkspaceStore | null = null
let callbackServer: Awaited<ReturnType<typeof createCallbackServer>> | null = null
let callbackReceiver: AuthorizationCallbackReceiver | null = null
let authorizationReady = false
let shutdownStarted = false
let cleanupLiveEvents = () => {}

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  callbackReceiver = createAuthorizationCallbackReceiver({
    app,
    onCallback: handleCallbackUrl,
    onSecondInstance: () => {
      mainWindow?.show()
      mainWindow?.focus()
    },
  })
  if (process.platform === "win32" || process.platform === "linux") {
    callbackReceiver.receiveArguments(process.argv)
  }
  registerIpcHandlers()
  void app
    .whenReady()
    .then(async () => {
      if (shutdownStarted) return
      let initialized = false
      try {
        await setupAuthorization()
        initialized = true
      } catch (error: unknown) {
        closeStartupEvents()
        authorizationSetupError = errorMessage(error)
        console.error(authorizationSetupError)
      }
      if (shutdownStarted) {
        closeStartupEvents()
        // 初始化可能晚于第一次关闭才建立服务；只清理，不重新开窗或放行回调。
        void shutdownDesktop()
        return
      }
      createWindow()
      if (initialized) {
        authorizationReady = true
        callbackReceiver?.ready()
        void desktopComposition?.membershipGate.inspect()
        void reportDeviceInfoOnStartup()
      }
      app.on("activate", () => {
        if (!shutdownStarted && BrowserWindow.getAllWindows().length === 0) createWindow()
      })
    })
    .catch(() => {
      closeStartupEvents()
      authorizationSetupError = "授权服务初始化失败"
      console.error("AUTHORIZATION_STARTUP_FAILED")
    })
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})

app.on(
  "before-quit",
  createQuitCoordinator({
    shutdown: shutdownDesktop,
    quit: () => app.quit(),
    forceExit: () => app.exit(0),
    onBeforeShutdown: () => {
      shutdownStarted = true
      closeStartupEvents()
    },
  }),
)

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

  registerMembershipIpc({
    getComposition: () => desktopComposition,
    isTrusted: isTrustedSender,
    onSignOut: () => {
      callbackReceiver?.clearPending()
    },
  })

  ipcMain.handle("pigclaude:authorization-start", async (event, value: unknown) => {
    const request = readAuthorizationRequest(value)
    if (!request || !authorizationReady || !authorizationService || !callbackServer) {
      const result: AuthorizationStartResult = {
        ok: false,
        status: "network-error",
        error: authorizationSetupError ?? "授权服务尚未准备好",
      }
      return result
    }
    let started: Awaited<ReturnType<AuthorizationService["start"]>> | null = null
    try {
      const redirectUri = app.isPackaged
        ? privateAuthorizationRedirectUri
        : callbackServer.redirectUri
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
      if (!isAllowedAuthorizationUrl(started.authorizationUrl, authOrigin)) {
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
  registerSessionIpc({
    getHost: () => sessionHost,
    getUsage: () => usageRecorder,
    isTrusted: isTrustedSender,
  })
  registerWorkspaceIpc()
}

/** 注册最近工作区的读取和追加；只保存路径，写操作只接受主窗口当前 frame。 */
function registerWorkspaceIpc(): void {
  ipcMain.handle("pigclaude:workspaces-list", async (event) => {
    if (!isTrustedSender(event)) throw new Error("UNTRUSTED_WORKSPACE_REQUEST")
    return getWorkspaceStore().list()
  })
  ipcMain.handle("pigclaude:workspaces-add", async (event, value: unknown) => {
    if (!isTrustedSender(event)) throw new Error("UNTRUSTED_WORKSPACE_REQUEST")
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error("WORKSPACE_UNAVAILABLE: 工作区必须是绝对路径")
    }
    return getWorkspaceStore().add(value)
  })
}

function getWorkspaceStore(): WorkspaceStore {
  workspaceStore ??= new WorkspaceStore({
    filePath: join(app.getPath("userData"), "workspaces.json"),
  })
  return workspaceStore
}

/** 应用退出时先结束会话并拒绝权限，再停 daemon、账号和回调服务。 */
async function shutdownDesktop(): Promise<void> {
  await sessionHost?.dispose().catch(() => undefined)
  await desktopComposition?.dispose().catch(() => undefined)
  void claudeAccountService?.dispose()
  await callbackServer?.close().catch(() => undefined)
}

/** 启动后已有授权时上报一次设备版本；失败只记日志，不重试也不提示用户。 */
async function reportDeviceInfoOnStartup(): Promise<void> {
  const composition = desktopComposition
  if (!composition) return
  try {
    const snapshot = await composition.tokenManager.snapshot()
    if (!snapshot) return
    const info = await readDeviceInfo()
    await composition.tokenManager.run((current) =>
      composition.api.reportDeviceInfo(info, current.record.accessToken),
    )
  } catch (error: unknown) {
    console.error(errorMessage(error))
  }
}

async function setupAuthorization(): Promise<void> {
  // 启动前清掉上次崩溃遗留的会话目录；此时还没有当前会话，调用后创建的目录不受影响。
  await cleanupStaleSessionDirs(app.getPath("userData")).catch(() => undefined)
  const vault = new FileSecretVault(
    join(app.getPath("userData"), "authorization-secrets.json"),
    safeStorage,
  )
  const deviceIdentity = new DeviceIdentityService()
  await deviceIdentity.read()
  callbackServer = await createCallbackServer(handleCallbackUrl)
  const localStore = new LocalStore(join(app.getPath("userData"), "local"))
  const composition = createDesktopComposition({
    authOrigin,
    websiteOrigin,
    openWebsite: (url) => shell.openExternal(url),
    apiOptions: { baseUrl: rustBaseUrl, authorizationOrigin: authOrigin },
    vault,
    deviceIdentity,
    onMembershipView: sendMembershipView,
    onAuthorizationState: sendAuthorizationState,
    localStore,
  })
  desktopComposition = composition
  authorizationService = composition.authorizationService

  const browser = new FingerprintChromiumAdapter({
    profilesRoot: join(app.getPath("userData"), "local", "browser-profiles"),
    binaryPath: process.env["PIGCLAUDE_FINGERPRINT_CHROMIUM_BIN"],
    screenSize: screen.getPrimaryDisplay().workAreaSize,
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
  usageRecorder = new UsageRecorder({ filePath: join(app.getPath("userData"), "usage.jsonl") })
  if (composition.runtime) {
    sessionHost = new SessionHost({
      membership: composition.membershipGate,
      runtime: composition.runtime,
      usage: usageRecorder,
      userDataPath: app.getPath("userData"),
      resolveBinaryPath: () => resolveClaudeBinaryPath(),
      defaultWorkspace: () => app.getPath("home"),
      resolveProfile: async (accountId) => {
        const accounts = await localStore.listAccounts()
        const proxies = new Map(
          (await localStore.listProxies()).map((proxy) => [proxy.id, proxy.url]),
        )
        const available = accounts.filter((item) =>
          isAccountSelectable(
            {
              enabled: item.enabled,
              needsReauth: item.needsReauth,
              hasCredential: item.credential !== null,
              exhaustedUntil: item.exhaustedUntil,
              proxyUrl: item.proxyId === null ? null : proxies.get(item.proxyId),
            },
            Date.now(),
          ),
        )
        const account =
          accountId === null
            ? (available[0] ?? accounts[0])
            : (accounts.find((item) => item.id === accountId) ?? available[0] ?? accounts[0])
        return account === undefined
          ? null
          : { timezone: account.fingerprint.timezone, locale: account.fingerprint.lang }
      },
    })
    sessionHost.subscribe(sendSessionEvent)
  }
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

async function handleCallbackUrl(url: string): Promise<AuthorizationStateEvent | null> {
  // loopback 继续直接返回既有结果；部分初始化不能成为可用授权服务。
  if (!authorizationReady || shutdownStarted || !authorizationService) return null
  const result = await authorizationService.handleCallback(url)
  if (result.sessionId && authorizationReady && !shutdownStarted) {
    sendAuthorizationState(result)
    mainWindow?.show()
    mainWindow?.focus()
  }
  return result
}

/** 终止启动/退出中的事件接收，不取消已经进入服务的原子提交。 */
function closeStartupEvents(): void {
  authorizationReady = false
  callbackReceiver?.dispose()
  cleanupLiveEvents()
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

function sendSessionEvent(event: SessionHostEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("pigclaude:session-event", event)
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
  mainWindow.once("closed", () => {
    void sessionHost?.stop().catch(() => undefined)
    mainWindow = null
  })
}

/** 外观变化时同步磨砂窗口的底色，深色下压暗系统材质。 */
function applyGlassBackground(): void {
  const color = glassBackgroundColor(process.platform, nativeTheme.shouldUseDarkColors)
  if (color) mainWindow?.setBackgroundColor(color)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "授权服务不可用"
}
