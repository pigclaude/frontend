// 负责创建桌面窗口、承接浏览器授权回调并保存主进程秘密。
import { app, BrowserWindow, ipcMain, nativeTheme, safeStorage, screen, shell } from "electron"
import { join } from "node:path"
import { readFileSync } from "node:fs"
import { scheduledTasksChangedChannel } from "../scheduled-tasks-contract"
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
import { reportDeviceInfoOnStartup } from "./device-identity/startup-device-report"
import { createDesktopTray } from "./desktop-tray"
import { createDesktopStartup, registerDesktopActivation } from "./desktop-startup"
import { createDesktopNotifications } from "./notifications/desktop-notifications"
import { registerDesktopWindowIpc } from "./desktop-window-ipc"
import { registerStartupPreferencesIpc } from "./startup-preferences-ipc"
import { createMainWindowVisibility } from "./main-window-visibility"
import { configureRuntimeProfile } from "./runtime-profile"
import { registerMembershipIpc } from "./membership/ipc"
import { readDesktopRuntimeEndpoints } from "./runtime-endpoints"
import { registerWorkspaceIpc } from "./runtime/workspace-ipc"
import { SessionDefaultsStore } from "./runtime/session-defaults"
import { registerSessionDefaultsIpc } from "./runtime/session-defaults-ipc"
import {
  createDesktopScheduledTaskService,
  reportScheduledTasksError,
} from "./scheduled-tasks/desktop-service"
import { registerScheduledTasksIpc } from "./scheduled-tasks/ipc"
import { trackDesktopWake } from "./scheduled-tasks/desktop-wake"
import type { ScheduledTaskService } from "./scheduled-tasks/service"
import { WorkbenchIpc } from "./workbench/workbench-ipc"
import { cleanupStaleSessionDirs } from "./session/session-environment"
import { startSessionStore } from "./session/session-store-startup"
import type { SessionHost } from "./session/session-host"
import type { SessionEnvelope } from "./session/session-envelope"
import { assembleSessionServices } from "./session/session-assembly"
import { registerProjectPermissionsIpc } from "./session/project-permissions-ipc"
import type { ProjectPermissionStore } from "./session/project-permission-store"
import { registerSessionIpc } from "./session/session-ipc"
import { installQuitFlow, watchPowerShutdown } from "./quit-flow"
import { noPendingWork } from "./session/session-host-support"
import { applyLoginShellPath } from "./login-shell-path"
import { createDesktopKeepAwake } from "./desktop-keep-awake"
import { registerKeepAwakeIpc } from "./keep-awake"
import { shutdownDesktopResources } from "./shutdown-resources"
import type { UsageRecorder } from "./session/usage-recorder"
import { FileSecretVault } from "./secret-vault"
import { forwardFullScreen } from "./window-ipc"
import { WindowClosePreference } from "./window-close-preference"
import { WindowNavigation } from "./window-navigation"
import { errorMessage } from "./error-message"
import { applyGlassBackground } from "./glass-background"
import { createMainWindowOptions, developmentRendererUrl } from "./window-options"
import { startDesktopUpdates } from "./updates/desktop-updates"
import { registerUpdateIpc } from "./updates/update-ipc"
import type { UpdateService } from "./updates/update-service"
import {
  createElectronPluginSandboxLaunch,
  registerPluginSandboxScheme,
} from "./plugins/plugin-sandbox-window"

if (process.type === "browser") registerPluginSandboxScheme()
const preloadDir = join(__dirname, "../preload")
const bundleMetadata: unknown = app.isPackaged
  ? JSON.parse(readFileSync(join(app.getAppPath(), "package.json"), "utf8"))
  : undefined
const { rustBaseUrl, authOrigin, websiteOrigin } = readDesktopRuntimeEndpoints(
  process.env,
  bundleMetadata,
)
const hasSingleInstanceLock = configureRuntimeProfile(app, process.env["PIGCLAUDE_USER_DATA"])
const startup = createDesktopStartup()
const sessionDefaults = new SessionDefaultsStore({
  filePath: join(app.getPath("userData"), "session-defaults.json"),
})
const keepAwake = createDesktopKeepAwake(app.getPath("userData"))
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
const windowVisibility = createMainWindowVisibility(() => mainWindow, createWindow)
const windowNavigation = new WindowNavigation(windowVisibility.restore, sendToMainWindow)
let cleanupLiveEvents = () => {}
let appUpdates: UpdateService | null = null
let scheduledTasks: ScheduledTaskService | null = null
const closePreference = new WindowClosePreference(
  join(app.getPath("userData"), "window-preferences.json"),
  process.platform,
)
let tray: ReturnType<typeof createDesktopTray> = null
const notifications = createDesktopNotifications({
  userDataPath: app.getPath("userData"),
  platform: process.platform,
  window: () => mainWindow,
  openSession: (id) => windowNavigation.openSession(id),
  openWindow: windowVisibility.restore,
  trayBadge: (active) => tray?.setNotificationBadge(active),
})

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  const loginShellPath = applyLoginShellPath()
  callbackReceiver = createAuthorizationCallbackReceiver({
    app,
    onCallback: handleCallbackUrl,
    onSecondInstance: (argv) =>
      startup.reopenFromSecondInstance(argv, windowVisibility.restoreExisting),
  })
  if (process.platform === "win32" || process.platform === "linux") {
    callbackReceiver.receiveArguments(process.argv)
  }
  const allowWindowRestore = registerDesktopActivation(startup, windowVisibility)
  registerIpcHandlers()
  void app
    .whenReady()
    .then(async () => {
      if (windowVisibility.shutdownStarted()) return
      keepAwake.ready()
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
      await Promise.all([loginShellPath, closePreference.get(), startup.prepare(process.argv)])
      if (windowVisibility.shutdownStarted()) {
        closeStartupEvents()
        // 初始化可能晚于第一次关闭才建立服务；只清理，不重新开窗或放行回调。
        void shutdownDesktop()
        return
      }
      createWindow()
      allowWindowRestore()
      tray = createDesktopTray({
        openWindow: windowVisibility.restore,
        navigate: (command) => windowNavigation.open(command),
        membership: () => desktopComposition?.membershipGate.view().state ?? "connecting",
        sessions: () => sessionHost?.livePreviews() ?? [],
        accounts: async () => (await claudeAccountService?.list()) ?? [],
        ...(scheduledTasks === null ? {} : { scheduledTasks }),
      })
      if (initialized) {
        authorizationReady = true
        callbackReceiver?.ready()
        void desktopComposition?.membershipGate.inspect()
        void reportDeviceInfoOnStartup(desktopComposition)
      }
      appUpdates = startDesktopUpdates((state) => sendToMainWindow("pigclaude:update-state", state))
      void scheduledTasks?.start().then(() => tray?.refresh(), reportScheduledTasksError)
    })
    .catch(() => {
      closeStartupEvents()
      authorizationSetupError = "授权服务初始化失败"
      console.error("AUTHORIZATION_STARTUP_FAILED")
    })
}

const guardMainWindowClose = installQuitFlow({
  pendingWork: () => sessionHost?.pendingWork() ?? noPendingWork,
  scheduledTasks: () => scheduledTasks?.summary().enabled ?? [],
  unsaved: workbench.unsaved,
  mainWindow: () => mainWindow,
  closeToTray: () => tray !== null && closePreference.current(),
  ...(hasSingleInstanceLock ? { watchPowerShutdown } : {}),
  shutdown: shutdownDesktop,
  onBeforeShutdown: windowVisibility.startShutdown,
  onShutdownFailure: () => {
    keepAwake.resumeAfterFailedShutdown()
    windowVisibility.shutdownFailed()
  },
  onCancel: () => appUpdates?.cancelRestart(),
  finishQuit: (mode) => {
    if (mode === "system") {
      keepAwake.dispose()
      return app.exit()
    }
    if (!appUpdates?.restartRequested()) return app.quit()
    void appUpdates.installAndRestart().finally(() => app.quit())
  },
})

function registerIpcHandlers(): void {
  registerDesktopWindowIpc(() => mainWindow, isTrustedSender, closePreference, windowNavigation)
  registerStartupPreferencesIpc(ipcMain, isTrustedSender, startup)
  registerScheduledTasksIpc({ getService: () => scheduledTasks, isTrusted: isTrustedSender })
  registerKeepAwakeIpc(ipcMain, keepAwake, isTrustedSender)
  registerSessionDefaultsIpc(ipcMain, {
    isTrusted: isTrustedSender,
    store: () => sessionDefaults,
  })
  registerUpdateIpc({ ipcMain, service: () => appUpdates, isTrusted: isTrustedSender })
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

/** 停止应用后台任务，再按依赖顺序释放资源。 */
async function shutdownDesktop(): Promise<void> {
  await shutdownDesktopResources({
    stopBackgroundWork: () => {
      keepAwake.holdForShutdown()
      appUpdates?.stop()
      closeStartupEvents()
      notifications.dispose()
      return scheduledTasks?.dispose()
    },
    accounts: () => claudeAccountService?.dispose() ?? Promise.resolve(),
    sessions: () => sessionHost?.dispose() ?? Promise.resolve(),
    workbench: () => workbench.dispose(),
    composition: () => desktopComposition?.dispose() ?? Promise.resolve(),
    xray: () => startProxyRuntime.dispose(),
    callback: () => callbackServer?.close() ?? Promise.resolve(),
    releaseAwake: () => keepAwake.dispose(),
    destroyTray: () => {
      tray?.destroy()
      tray = null
    },
  })
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
    launchPluginSandbox: createElectronPluginSandboxLaunch(join(preloadDir, "plugin-sandbox.js")),
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
    onEvent: (event) => sendSessionEvent(event, sessionStore),
  })
  usageRecorder = sessions.usage
  sessionHost = sessions.host
  projectPermissions = sessions.projectPermissions
  sessionHost?.subscribe((envelope) => keepAwake.observe(envelope))
  const host = sessions.host
  if (composition.runtime && host) {
    scheduledTasks = createDesktopScheduledTaskService({
      userDataPath: app.getPath("userData"),
      authorization: composition,
      runtime: composition.runtime,
      defaults: sessionDefaults,
      usesDevProvider: sessions.usesDevProvider,
      runSession: (task, signal) => host.runScheduledTask(task, signal),
      presentation: {
        refreshTray: () => {
          sendToMainWindow(scheduledTasksChangedChannel)
          tray?.refresh()
        },
        announce: notifications.announce,
      },
    })
  }
  const checkLive = () => void desktopComposition?.resume()
  app.on("browser-window-focus", checkLive)
  const stopWake = trackDesktopWake(composition.membershipGate, scheduledTasks)
  const unsubscribeAccounts = localStore.subscribeAccounts(() => tray?.accountsChanged())
  cleanupLiveEvents = () => {
    app.removeListener("browser-window-focus", checkLive)
    stopWake()
    unsubscribeAccounts()
  }
  if (app.isPackaged) app.setAsDefaultProtocolClient("pigclaude")
}

async function handleCallbackUrl(url: string): Promise<AuthorizationStateEvent | null> {
  // loopback 继续直接返回既有结果；部分初始化不能成为可用授权服务。
  if (!authorizationReady || windowVisibility.shutdownStarted() || !authorizationService)
    return null
  const result = await authorizationService.handleCallback(url)
  if (result.sessionId && authorizationReady && !windowVisibility.shutdownStarted()) {
    sendAuthorizationState(result)
    windowVisibility.restoreExisting()
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
  notifications.membership(view.state)
  workbench.membershipChanged(view)
  sendToMainWindow("pigclaude:membership-state", view)
  tray?.refresh()
}

function sendSessionEvent(
  envelope: SessionEnvelope,
  store: ReturnType<typeof startSessionStore>,
): void {
  notifications.session(envelope, store)
  sendToMainWindow("pigclaude:session-event", envelope)
  tray?.sessionChanged(envelope.event.type)
}

function sendToMainWindow(channel: string, payload?: unknown): void {
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
      preloadPath: join(preloadDir, "index.js"),
      isPackaged: app.isPackaged,
      dark: nativeTheme.shouldUseDarkColors,
    }),
  )
  mainWindow.on("focus", notifications.windowFocused)
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
  startup.attachWindow(mainWindow)
  mainWindow.once("closed", () => {
    mainWindow = null
  })
}
