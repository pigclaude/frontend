// 负责贯通真实主进程与授权服务的合成回调夹具；系统事件、交换和安全仓库均不接触真实环境。
import { EventEmitter } from "node:events"
import { fileURLToPath } from "node:url"
import { vi } from "vitest"
import { AuthorizationService } from "../authorization/service"
import type { AuthorizationStateEvent, AuthorizationToken } from "../authorization/types"
import { deferred, membershipView, ProfileVault } from "./profile-fixture"

type MainIpcEvent = {
  sender: { send(channel: string, value: unknown): void }
  senderFrame?: object
}
type MainIpcHandler = (event: MainIpcEvent, value?: unknown) => unknown
type WindowFixture = {
  webContents: { mainFrame: object; send(channel: string, value: unknown): void }
  show(): void
  focus(): void
}

const fixture = vi.hoisted(() => ({
  appEvents: null as EventEmitter | null,
  powerEvents: null as EventEmitter | null,
  handlers: new Map<string, MainIpcHandler>(),
  windows: [] as WindowFixture[],
  sent: [] as { channel: string; value: unknown }[],
  ready: null as ReturnType<typeof deferred<void>> | null,
  windowReady: null as ReturnType<typeof deferred<void>> | null,
  shutdownGate: null as ReturnType<typeof deferred<void>> | null,
  service: null as AuthorizationService | null,
  vault: null as ProfileVault | null,
  progress: null as ((event: AuthorizationStateEvent) => void) | null,
  hasLock: true,
  setupFailure: false,
  readinessFailure: null as Error | null,
  screenFailure: false,
  setupGate: null as ReturnType<typeof deferred<void>> | null,
  callbackServerEntries: 0,
  deviceReads: 0,
  setupEntered: 0,
  quitCalls: 0,
  focusCalls: 0,
  closeCalls: 0,
  registrationCalls: 0,
  runtimeEnabled: false,
  callbackCreates: 0,
  compositionDisposals: 0,
  beforeCommit: null as (() => Promise<void>) | null,
  commits: 0,
  abandoned: null as (() => Promise<void>) | null,
  userData: "/callback-reception-fixture",
  powerBlocker: { start: vi.fn(() => 0), stop: vi.fn() },
}))

vi.mock("electron", () => ({
  app: {
    isPackaged: true,
    whenReady: () =>
      fixture.ready!.promise.then(() => {
        if (fixture.readinessFailure) throw fixture.readinessFailure
      }),
    on: (name: string, listener: (...args: unknown[]) => void) =>
      fixture.appEvents!.on(name, listener),
    removeListener: (name: string, listener: (...args: unknown[]) => void) =>
      fixture.appEvents!.removeListener(name, listener),
    getPath: () => fixture.userData,
    getVersion: () => "0.0.1",
    getLoginItemSettings: () => ({ openAtLogin: false, wasOpenedAtLogin: false }),
    setAppUserModelId: vi.fn(),
    getAppPath: () => fileURLToPath(new URL("../../../", import.meta.url)),
    setAsDefaultProtocolClient: () => {
      fixture.registrationCalls++
      return true
    },
    quit: () => fixture.quitCalls++,
    exit: () => fixture.quitCalls++,
  },
  powerMonitor: {
    on: (name: string, listener: (...args: unknown[]) => void) =>
      fixture.powerEvents!.on(name, listener),
    removeListener: (name: string, listener: (...args: unknown[]) => void) =>
      fixture.powerEvents!.removeListener(name, listener),
  },
  BrowserWindow: Object.assign(
    class {
      webContents = {
        mainFrame: {},
        on: vi.fn(),
        setWindowOpenHandler: vi.fn(),
        isDestroyed: () => false,
        send: (channel: string, value: unknown) => fixture.sent.push({ channel, value }),
      }
      constructor() {
        fixture.windows.push(this)
        fixture.windowReady!.resolve(undefined)
      }
      loadFile() {}
      once() {}
      on() {}
      setBackgroundColor() {}
      isDestroyed() {
        return false
      }
      isMinimized() {
        return false
      }
      show() {}
      focus() {
        fixture.focusCalls++
      }
    },
    { getAllWindows: () => fixture.windows },
  ),
  ipcMain: {
    handle: (channel: string, handler: MainIpcHandler) => fixture.handlers.set(channel, handler),
  },
  dialog: {},
  powerSaveBlocker: fixture.powerBlocker,
  nativeImage: {},
  nativeTheme: { on: () => {}, shouldUseDarkColors: false },
  screen: {
    getPrimaryDisplay: () => {
      if (fixture.screenFailure) throw new Error("fixture display unavailable")
      return { workAreaSize: { width: 1920, height: 1080 } }
    },
  },
  safeStorage: {},
  shell: { openExternal: async () => undefined },
}))
vi.mock("../updates/app-updates", () => import("./inert-app-updates"))
vi.mock("../login-shell-path", () => ({ applyLoginShellPath: async () => undefined }))
vi.mock("../runtime-profile", () => ({
  configureRuntimeProfile: () => fixture.hasLock,
}))
vi.mock("../runtime-endpoints", () => ({
  readDesktopRuntimeEndpoints: () => ({
    rustBaseUrl: "https://api.fixture.invalid",
    authOrigin: "https://auth.fixture.invalid",
    websiteOrigin: "https://auth.fixture.invalid",
  }),
}))
vi.mock("../device-identity", () => ({
  DeviceIdentityService: class {
    async read() {
      fixture.deviceReads++
      return { deviceId: "pcd_" + "1".repeat(64), platform: "darwin" }
    }
  },
}))
vi.mock("../device-identity/device-info", () => ({
  readDeviceInfo: async () => ({ name: "fixture", osVersion: "fixture", appVersion: "0.0.1" }),
}))
vi.mock("../secret-vault", () => ({
  FileSecretVault: class {
    constructor() {
      return fixture.vault!
    }
  },
}))
vi.mock("../authorization/callback-server", () => ({
  createCallbackServer: async () => {
    fixture.callbackServerEntries++
    await fixture.setupGate?.promise
    if (fixture.setupFailure) throw new Error("fixture initialization failed")
    fixture.callbackCreates++
    return {
      redirectUri: "http://127.0.0.1:43123/oauth/callback",
      close: async () => {
        fixture.closeCalls++
      },
    }
  },
}))
vi.mock("../composition", () => ({
  createDesktopComposition: (options: {
    onAuthorizationState: (event: AuthorizationStateEvent) => void
  }) => {
    fixture.setupEntered++
    fixture.progress = options.onAuthorizationState
    return {
      authorizationService: fixture.service,
      membershipGate: { inspect: async () => null },
      tokenManager: { snapshot: async () => null },
      api: { reportDeviceInfo: async () => undefined },
      runtime: fixture.runtimeEnabled ? {} : null,
      resume: async () => null,
      signOut: async () => {
        await fixture.service!.suspend()
        await fixture.vault!.deletePrefix("authorization:pigclaude-login:")
        await fixture.vault!.delete("membership:session")
        fixture.service!.resume()
        return membershipView("signed_out")
      },
      dispose: async () => {
        fixture.compositionDisposals++
        await fixture.service!.suspend()
      },
    }
  },
}))
vi.mock("../window-options", () => ({
  createMainWindowOptions: () => ({}),
  developmentRendererUrl: () => undefined,
  glassBackgroundColor: () => undefined,
  readThemeSource: () => undefined,
}))
vi.mock("../session/session-environment", () => ({
  cleanupStaleSessionDirs: async () => undefined,
}))
vi.mock("../session/session-host", () => ({
  SessionHost: class {
    subscribe() {}
    pendingWork = () => ({ runningSessions: 0, turns: 0, approvals: 0 })
    stop = async () => undefined
    dispose = async () => fixture.shutdownGate!.promise
    runScheduledTask = async () => ({ status: "stopped" as const })
  },
}))

/** 准备新的纯内存授权服务和系统端口，返回可控制初始化及交换的夹具。 */
export function createCallbackReceptionFixture() {
  fixture.appEvents = new EventEmitter()
  fixture.powerEvents = new EventEmitter()
  fixture.handlers.clear()
  fixture.windows = []
  fixture.sent = []
  fixture.ready = deferred<void>()
  fixture.windowReady = deferred<void>()
  fixture.shutdownGate = deferred<void>()
  fixture.progress = null
  fixture.hasLock = true
  fixture.setupFailure = false
  fixture.readinessFailure = null
  fixture.screenFailure = false
  fixture.setupGate = null
  fixture.callbackServerEntries = 0
  fixture.deviceReads = 0
  fixture.setupEntered = 0
  fixture.quitCalls = 0
  fixture.focusCalls = 0
  fixture.closeCalls = 0
  fixture.registrationCalls = 0
  fixture.runtimeEnabled = false
  fixture.callbackCreates = 0
  fixture.compositionDisposals = 0
  fixture.beforeCommit = null
  fixture.commits = 0
  fixture.abandoned = null
  fixture.userData = "/callback-reception-fixture"
  fixture.powerBlocker.start.mockClear()
  fixture.powerBlocker.stop.mockClear()
  const vault = new ProfileVault()
  fixture.vault = vault
  const exchange = vi.fn(async (): Promise<AuthorizationToken> => callbackReceptionToken())
  const service = new AuthorizationService({
    authOrigin: "https://auth.fixture.invalid",
    vault,
    exchangeCode: exchange,
    deviceIdentity: {
      read: async () => ({ deviceId: "pcd_" + "1".repeat(64), platform: "darwin" }),
    },
    deviceInfo: async () => ({ name: "fixture", osVersion: "fixture", appVersion: "0.0.1" }),
    startAuthorization: async (input) => ({
      contextId: "callback-fixture-context",
      authorizationUrl: `https://auth.fixture.invalid/oauth2/authorize?state=${input.state}`,
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    }),
    onProgress: (event) => fixture.progress?.(event),
    onAbandoned: async () => fixture.abandoned?.(),
    commitAuthorization: async ({ token, isCurrent }) => {
      if (!token.oauthSession || !isCurrent()) return
      fixture.commits++
      // 暂停的是已进入本机提交端口的写入，不是可取消的网络准备阶段。
      await fixture.beforeCommit?.()
      await vault.set("membership:session", JSON.stringify(token.oauthSession))
    },
  })
  fixture.service = service
  return { fixture, service, vault, exchange }
}

/** 创建只供合成兑换使用的 token，不含真实身份或凭据。 */
export function callbackReceptionToken(): AuthorizationToken {
  return {
    accountId: "callback-fixture-user",
    displayName: "callback fixture",
    accessToken: "callback-fixture-access",
    refreshToken: "callback-fixture-refresh",
    expiresAt: Date.now() + 300_000,
    purpose: "pigclaude-login",
    mode: "login",
  }
}

/** 从真实授权服务创建有效私有协议回调，不手工伪造 state 或 verifier。 */
export async function prepareCallbackReceptionUrl(service: AuthorizationService): Promise<string> {
  await service.start(
    { purpose: "pigclaude-login", mode: "login" },
    "pigclaude://authorize/callback",
  )
  return activeCallbackReceptionUrl(service)
}

/** 返回现有真实 pending 会话对应的合成回调，保留原 redirect 与 state。 */
export function activeCallbackReceptionUrl(service: AuthorizationService): string {
  const session = service.getActiveSession()
  if (!session) throw new Error("fixture pending authorization missing")
  return `${session.redirectUri}?code=callback-fixture-code&state=${session.state}`
}

/** 模拟已注册的 open-url 事件，保留原始 URL 值供生产入口处理。 */
export function emitCallbackReceptionUrl(url: string): void {
  fixture.appEvents!.emit("open-url", { preventDefault: () => undefined }, url)
}

/** 模拟已有实例命令行事件，不改变候选 URL 的位置或内容。 */
export function emitCallbackReceptionArguments(commandLine: string[]): void {
  fixture.appEvents!.emit("second-instance", {}, commandLine, "/fixture-working-directory")
}

/** 调用生产注册的主进程 IPC，使用实际主窗口来源证明。 */
export async function invokeCallbackReceptionIpc(
  channel: string,
  value?: unknown,
): Promise<unknown> {
  const handler = fixture.handlers.get(channel)
  const window = fixture.windows[0]
  if (!handler || !window) throw new Error("fixture IPC is not ready")
  return handler({ sender: window.webContents, senderFrame: window.webContents.mainFrame }, value)
}

/** 释放应用 ready 边界并等待生产入口创建窗口，然后结清当前微任务。 */
export async function finishCallbackReceptionStartup(): Promise<void> {
  fixture.ready!.resolve(undefined)
  await fixture.windowReady!.promise
  await vi.advanceTimersByTimeAsync(0)
}

/** 触发真实退出协调器，清理本测试的事件与计时边界。 */
export async function disposeCallbackReceptionFixture(): Promise<void> {
  fixture.shutdownGate!.resolve(undefined)
  fixture.appEvents!.emit("before-quit", { preventDefault: () => undefined })
  await vi.advanceTimersByTimeAsync(0)
}
