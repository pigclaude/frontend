// 负责创建桌面窗口、承接浏览器授权回调并保存主进程秘密。
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeImage,
  nativeTheme,
  net,
  powerMonitor,
  safeStorage,
  screen,
  shell,
} from "electron"
import { join } from "node:path"
import { readFileSync } from "node:fs"
import type { MembershipView } from "@pigclaude/contracts/membership"
import { LocalStore } from "@pigclaude/local-store"
import { checkEgress } from "@pigclaude/login-gate/egress-check"
import { createCallbackServer } from "./authorization/callback-server"
import {
  createAuthorizationCallbackReceiver,
  type AuthorizationCallbackReceiver,
} from "./authorization/callback-receiver"
import type { AuthorizationService } from "./authorization/service"
import type { AuthorizationStateEvent } from "./authorization/types"
import { registerAuthorizationIpc } from "./authorization/authorization-ipc"
import { isAllowedAuthorizationUrl } from "./authorization/url-policy"
import { ClaudeAccountService } from "./claude/account-service"
import { ClaudeAccountError } from "./claude/errors"
import { FingerprintChromiumAdapter } from "./claude/fingerprint-chromium"
import { registerClaudeIpc } from "./claude/ipc"
import { ProxyService } from "./claude/proxy-service"
import { runtimeHostArch } from "./claude/runtime-binary"
import { SubscriptionOAuth } from "./claude/subscription-oauth"
import { createXrayRuntimeStarter } from "./claude/xray-runtime"
import { NativeEnvironmentInspector } from "./claude/native-environment"
import { BrowserProfileService } from "./claude/browser-profile-service"
import { BrowserProfileUsage } from "./claude/browser-profile-usage"
import { registerBrowserProfileIpc } from "./claude/browser-profile-ipc"
import { createDesktopComposition, type DesktopComposition } from "./composition"
import { DeviceIdentityService } from "./device-identity"
import { readDeviceInfo } from "./device-identity/device-info"
import { readDockIconDataUrl } from "./dock-icon"
import { configureRuntimeProfile } from "./runtime-profile"
import { registerMembershipIpc } from "./membership/ipc"
import { readDesktopRuntimeEndpoints } from "./runtime-endpoints"
import { registerWorkspaceIpc } from "./runtime/workspace-ipc"
import { SessionDefaultsStore } from "./runtime/session-defaults"
import { registerSessionDefaultsIpc } from "./runtime/session-defaults-ipc"
import { readClaudeCodeVersion } from "./session/claude-version"
import { WorkbenchIpc } from "./workbench/workbench-ipc"
import { cleanupStaleSessionDirs } from "./session/session-environment"
import { startSessionStore } from "./session/session-store-startup"
import type { SessionHost } from "./session/session-host"
import { assembleSessionServices } from "./session/session-assembly"
import { registerProjectPermissionsIpc } from "./session/project-permissions-ipc"
import type { ProjectPermissionStore } from "./session/project-permission-store"
import { registerSessionIpc } from "./session/session-ipc"
import { installQuitFlow } from "./quit-flow"
import { noPendingWork } from "./session/session-host-support"
import { applyLoginShellPath } from "./login-shell-path"
import { shutdownDesktopResources } from "./shutdown-resources"
import type { UsageRecorder } from "./session/usage-recorder"
import { FileSecretVault } from "./secret-vault"
import { registerFolderPickerIpc } from "./folder-picker"
import { forwardFullScreen, registerWindowIpc } from "./window-ipc"
import { electronMenuFactory } from "./native-menu"
import { errorMessage } from "./error-message"
import { applyGlassBackground } from "./glass-background"
import { createMainWindowOptions, developmentRendererUrl, readThemeSource } from "./window-options"
import { createAppUpdates } from "./updates/app-updates"
import { registerUpdateIpc } from "./updates/update-ipc"
import type { UpdateService } from "./updates/update-service"

const bundleMetadata: unknown = app.isPackaged
  ? JSON.parse(readFileSync(join(app.getAppPath(), "package.json"), "utf8"))
  : undefined
const { rustBaseUrl, authOrigin, websiteOrigin } = readDesktopRuntimeEndpoints(
  process.env,
  bundleMetadata,
)
const hasSingleInstanceLock = configureRuntimeProfile(app, process.env["PIGCLAUDE_USER_DATA"])
const hostArch = runtimeHostArch(app.runningUnderARM64Translation)
const startProxyRuntime = createXrayRuntimeStarter({
  hostArch,
  resourcesPath: app.isPackaged ? process.resourcesPath : undefined,
})
let mainWindow: BrowserWindow | null = null
const workbench = new WorkbenchIpc()
let authorizationService: AuthorizationService | null = null
let authorizationSetupError: string | undefined
let desktopComposition: DesktopComposition | null = null
let claudeAccountService: ClaudeAccountService | null = null
let proxyService: ProxyService | null = null
let browserProfileService: BrowserProfileService | null = null
let sessionHost: SessionHost | null = null
let usageRecorder: UsageRecorder | null = null
let projectPermissions: ProjectPermissionStore | null = null
let callbackServer: Awaited<ReturnType<typeof createCallbackServer>> | null = null
let callbackReceiver: AuthorizationCallbackReceiver | null = null
let authorizationReady = false
let shutdownStarted = false
let cleanupLiveEvents = () => {}
let appUpdates: UpdateService | null = null

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  const loginShellPath = applyLoginShellPath()
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
      // 会话和工作台终端在窗口打开后才可能启动，它们要用合并后的 PATH。
      await loginShellPath
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
      startAppUpdates()
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

const guardMainWindowClose = installQuitFlow({
  pendingWork: () => sessionHost?.pendingWork() ?? noPendingWork,
  unsaved: workbench.unsaved,
  mainWindow: () => mainWindow,
  shutdown: shutdownDesktop,
  onBeforeShutdown: () => {
    shutdownStarted = true
    appUpdates?.stop()
    closeStartupEvents()
  },
  onCancel: () => appUpdates?.cancelRestart(),
  finishQuit: () => {
    if (!appUpdates?.restartRequested()) return app.quit()
    void appUpdates.installAndRestart().finally(() => app.quit())
  },
})

function registerIpcHandlers(): void {
  let claudeCodeVersion = readClaudeCodeVersion()
  ipcMain.handle("pigclaude:app-info", async () => {
    const version = await claudeCodeVersion
    if (version === null) claudeCodeVersion = readClaudeCodeVersion()
    return {
      appVersion: app.getVersion(),
      userDataPath: app.getPath("userData"),
      claudeCodeVersion: version,
    }
  })
  let sessionDefaults: SessionDefaultsStore | null = null
  registerSessionDefaultsIpc(ipcMain, {
    isTrusted: isTrustedSender,
    store: () =>
      (sessionDefaults ??= new SessionDefaultsStore({
        filePath: join(app.getPath("userData"), "session-defaults.json"),
      })),
  })
  registerUpdateIpc({ ipcMain, service: () => appUpdates, isTrusted: isTrustedSender })
  registerFolderPickerIpc(ipcMain, (options) =>
    mainWindow ? dialog.showOpenDialog(mainWindow, options) : dialog.showOpenDialog(options),
  )
  registerWindowIpc({
    ipcMain,
    windows: BrowserWindow,
    nativeTheme,
    menus: electronMenuFactory(),
    platform: process.platform,
    systemVersion:
      typeof process.getSystemVersion === "function" ? process.getSystemVersion() : "unknown",
    allowDevRoles: !app.isPackaged,
    isTrusted: isTrustedSender,
  })
  ipcMain.handle("pigclaude:set-theme", (_event, value: unknown) => {
    const source = readThemeSource(value)
    if (source) nativeTheme.themeSource = source
  })
  nativeTheme.on("updated", () =>
    applyGlassBackground(mainWindow, process.platform, nativeTheme.shouldUseDarkColors),
  )
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
  registerAuthorizationIpc({
    ready: () =>
      authorizationReady && authorizationService && callbackServer
        ? { service: authorizationService, redirectUri: callbackServer.redirectUri }
        : null,
    service: () => authorizationService,
    setupError: () => authorizationSetupError,
    isPackaged: app.isPackaged,
    authOrigin,
    onState: sendAuthorizationState,
  })
  registerClaudeIpc({
    getService: () => claudeAccountService,
    getProxyService: () => proxyService,
    isTrusted: isTrustedSender,
  })
  registerBrowserProfileIpc({ getService: () => browserProfileService, isTrusted: isTrustedSender })
  registerSessionIpc({
    getHost: () => sessionHost,
    getUsage: () => usageRecorder,
    isTrusted: isTrustedSender,
    tools: (event) => workbench.tools(event.sender, hasActiveMembership),
  })
  registerProjectPermissionsIpc(ipcMain, {
    getStore: () => projectPermissions,
    isTrusted: isTrustedSender,
  })
  registerWorkspaceIpc({
    filePath: () => join(app.getPath("userData"), "workspaces.json"),
    isTrusted: isTrustedSender,
    workbench,
    membership: () => desktopComposition?.membershipGate.view(),
    hasActiveTurn: (workspace) => sessionHost?.hasActiveTurn(workspace) ?? false,
  })
}

/** 应用退出时先关闭浏览器和账号资源，再关闭 Xray。 */
async function shutdownDesktop(): Promise<void> {
  await shutdownDesktopResources({
    accounts: () => claudeAccountService?.dispose() ?? Promise.resolve(),
    sessions: () => sessionHost?.dispose() ?? Promise.resolve(),
    workbench: () => workbench.dispose(),
    composition: () => desktopComposition?.dispose() ?? Promise.resolve(),
    xray: () => startProxyRuntime.dispose(),
    callback: () => callbackServer?.close() ?? Promise.resolve(),
  })
}

/** 窗口打开后开始检查更新；更新服务建不起来只记日志，不影响应用其余部分。 */
function startAppUpdates(): void {
  try {
    appUpdates = createAppUpdates({
      requestQuit: () => app.quit(),
      onState: (state) => sendToMainWindow("pigclaude:update-state", state),
    })
    appUpdates.start()
  } catch (error: unknown) {
    console.error(errorMessage(error))
  }
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
  const sessionStore = startSessionStore(app.getPath("userData"))
  const vault = new FileSecretVault(
    join(app.getPath("userData"), "authorization-secrets.json"),
    safeStorage,
  )
  const deviceIdentity = new DeviceIdentityService()
  // 不等读取：Windows 首次启动 PowerShell 要几秒；登录时授权服务等同一次读取，失败会重读。
  void deviceIdentity.read().catch((error: unknown) => console.error(errorMessage(error)))
  callbackServer = await createCallbackServer(handleCallbackUrl)
  const systemLocale = () => app.getSystemLocale()
  const profileUsage = new BrowserProfileUsage()
  const localStore = new LocalStore(join(app.getPath("userData"), "local"), { systemLocale })
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
    profileUsage,
  })
  desktopComposition = composition
  authorizationService = composition.authorizationService

  const browser = new FingerprintChromiumAdapter({
    profilesRoot: join(app.getPath("userData"), "local", "browser-profiles"),
    binaryPath: process.env["PIGCLAUDE_PIGBROWSER_BIN"],
    hostArch,
    resourcesPath: app.isPackaged ? process.resourcesPath : join(__dirname, "../../runtime-assets"),
    screenSize: screen.getPrimaryDisplay().workAreaSize,
  })
  browserProfileService = new BrowserProfileService({
    store: localStore,
    usage: profileUsage,
    systemLocale,
  })
  claudeAccountService = new ClaudeAccountService({
    store: localStore,
    profileUsage,
    systemLocale,
    browser,
    oauth: new SubscriptionOAuth(),
    checkEgress,
    startProxyRuntime,
    nativeDiagnostics: new NativeEnvironmentInspector({
      systemLocale: () => app.getSystemLocale(),
    }),
    ensureMembership: async () => {
      const view = await composition.membershipGate.inspect()
      if (view.state !== "active") {
        throw new ClaudeAccountError("MEMBERSHIP_REQUIRED", "会员状态不可用")
      }
    },
    onEvent: (event) => sendToMainWindow("pigclaude:claude-account-state", event),
  })
  proxyService = new ProxyService({
    store: localStore,
    profileUsage,
    startProxyRuntime,
  })
  const sessions = assembleSessionServices({
    sessionStore,
    userDataPath: app.getPath("userData"),
    homePath: app.getPath("home"),
    membership: composition.membershipGate,
    runtime: composition.runtime ?? null,
    store: localStore,
    systemLocale,
    isPackaged: app.isPackaged,
    env: process.env,
    onEvent: (event) => sendToMainWindow("pigclaude:session-event", event),
  })
  usageRecorder = sessions.usage
  sessionHost = sessions.host
  projectPermissions = sessions.projectPermissions
  const checkLive = () => {
    void desktopComposition?.resume()
  }
  const resumeAfterSleep = () =>
    desktopComposition?.membershipGate.resumeAfterWake(() => net.isOnline())
  app.on("browser-window-focus", checkLive)
  powerMonitor.on("resume", resumeAfterSleep)
  cleanupLiveEvents = () => {
    app.removeListener("browser-window-focus", checkLive)
    powerMonitor.removeListener("resume", resumeAfterSleep)
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
  sendToMainWindow("pigclaude:authorization-state", event)
}

function hasActiveMembership(): boolean {
  return desktopComposition?.membershipGate.view().state === "active"
}

function sendMembershipView(view: MembershipView): void {
  workbench.membershipChanged(view)
  sendToMainWindow("pigclaude:membership-state", view)
}

function sendToMainWindow(channel: string, payload: unknown): void {
  const contents = mainWindow?.webContents
  if (contents && !contents.isDestroyed()) contents.send(channel, payload)
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
      dark: nativeTheme.shouldUseDarkColors,
    }),
  )
  forwardFullScreen(mainWindow)
  guardMainWindowClose(mainWindow)
  workbench.track(mainWindow)
  const devRendererUrl = developmentRendererUrl(
    app.isPackaged,
    process.env["ELECTRON_RENDERER_URL"],
  )
  if (devRendererUrl) {
    void mainWindow.loadURL(devRendererUrl)
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"))
  }
  applyGlassBackground(mainWindow, process.platform, nativeTheme.shouldUseDarkColors)
  mainWindow.once("ready-to-show", () => mainWindow?.show())
  mainWindow.once("closed", () => {
    void sessionHost?.stop().catch(() => undefined)
    mainWindow = null
  })
}
