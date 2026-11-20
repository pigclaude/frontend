// 负责执行真实主进程入口，以 Electron 边界替身验证远程检查不会阻止窗口出现。
import { expect, it, vi } from "vitest"
import { deferred } from "./testing/profile-fixture"
const fixture = vi.hoisted(() => ({
  windows: 0,
  activate: null as (() => void) | null,
  readyToShow: null as (() => void) | null,
  beginAuthorization: () => {},
  authorizationReady: Promise.resolve(),
  show: vi.fn(),
  focus: vi.fn(),
  inspect: vi.fn(() => new Promise<void>(() => {})),
  snapshot: vi.fn(async () => null),
  reportDeviceInfo: vi.fn(async () => undefined),
}))
vi.mock("electron", () => ({
  powerSaveBlocker: { start: () => 0, stop: () => {} },
  powerMonitor: { on: () => {}, removeListener: () => {} },
  app: {
    isPackaged: false,
    whenReady: () => Promise.resolve(),
    on: vi.fn((name: string, listener: () => void) => {
      if (name === "activate") fixture.activate = listener
    }),
    removeListener: vi.fn(),
    getPath: () => "/fixture",
    quit: vi.fn(),
  },
  BrowserWindow: Object.assign(
    class {
      webContents = {
        send: vi.fn(),
        on: vi.fn(),
        isDestroyed: () => false,
        setWindowOpenHandler: vi.fn(),
      }
      constructor() {
        fixture.windows++
      }
      loadFile() {}
      once(name: string, listener: () => void) {
        if (name === "ready-to-show") fixture.readyToShow = listener
      }
      on() {}
      isDestroyed = () => false
      isMinimized = () => false
      show = fixture.show
      focus = fixture.focus
      setBackgroundColor() {}
    },
    { getAllWindows: () => [] },
  ),
  dialog: {},
  ipcMain: { handle: vi.fn() },
  nativeTheme: { on: vi.fn() },
  screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }) },
  safeStorage: {},
  shell: {},
}))
vi.mock("./updates/app-updates", () => import("./testing/inert-app-updates"))
vi.mock("./login-shell-path", () => ({ applyLoginShellPath: async () => undefined }))
vi.mock("./runtime-profile", () => ({ configureRuntimeProfile: () => true }))
vi.mock("./runtime-endpoints", () => ({
  readDesktopRuntimeEndpoints: () => ({
    rustBaseUrl: "https://api.pigclaude.com",
    authOrigin: "https://pigclaude.com",
  }),
}))
vi.mock("./device-identity", () => ({
  DeviceIdentityService: class {
    read = async () => ({ deviceId: "pcd_" + "1".repeat(64), platform: "darwin" })
  },
}))
vi.mock("./secret-vault", () => ({ FileSecretVault: class {} }))
vi.mock("./authorization/callback-server", () => ({
  createCallbackServer: async () => {
    fixture.beginAuthorization()
    await fixture.authorizationReady
    return { close: vi.fn() }
  },
}))
vi.mock(import("./desktop-startup"), async (importOriginal) => {
  const { StartupPreferences } = await import("./startup-preferences")
  return {
    ...(await importOriginal()),
    createDesktopStartup: () =>
      new StartupPreferences(
        {
          enabled: async () => true,
          set: async (enabled) => enabled,
          openedAutomatically: () => true,
        },
        null,
      ),
  }
})
vi.mock("./composition", () => ({
  createDesktopComposition: () => ({
    authorizationService: {},
    membershipGate: { inspect: fixture.inspect },
    tokenManager: { snapshot: fixture.snapshot, run: vi.fn() },
    api: { reportDeviceInfo: fixture.reportDeviceInfo },
  }),
}))
vi.mock("./window-options", () => ({
  createMainWindowOptions: () => ({}),
  developmentRendererUrl: () => undefined,
  glassBackgroundColor: () => undefined,
  readThemeSource: () => undefined,
}))
it("honors a macOS reopen during login startup and shows the checking window before membership inspection finishes", async () => {
  const started = deferred<void>()
  const proceed = deferred<void>()
  fixture.beginAuthorization = () => started.resolve(undefined)
  fixture.authorizationReady = proceed.promise
  try {
    await import("./index")
    await started.promise
    expect(fixture.activate).toBeTypeOf("function")
    fixture.activate?.()
    expect(fixture.windows).toBe(0)
    expect(fixture.show).not.toHaveBeenCalled()

    proceed.resolve(undefined)
    await vi.waitFor(() => expect(fixture.inspect).toHaveBeenCalledOnce())
    expect(fixture.reportDeviceInfo).not.toHaveBeenCalled()
    expect(fixture.windows).toBe(1)

    // Dock 再次激活时，已有的原生窗口仍在等待渲染首帧。
    fixture.activate?.()
    fixture.activate?.()
    expect(fixture.windows).toBe(1)
    expect(fixture.show).not.toHaveBeenCalled()
    expect(fixture.focus).not.toHaveBeenCalled()

    fixture.readyToShow?.()
    expect(fixture.show).toHaveBeenCalledOnce()
    expect(fixture.focus).toHaveBeenCalledOnce()

    fixture.activate?.()
    expect(fixture.focus).toHaveBeenCalledTimes(2)
  } finally {
    proceed.resolve(undefined)
  }
})
