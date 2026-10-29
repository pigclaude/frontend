// 负责执行真实主进程入口，以 Electron 边界替身验证远程检查不会阻止窗口出现。
import { expect, it, vi } from "vitest"
const fixture = vi.hoisted(() => ({
  windows: 0,
  inspect: vi.fn(() => new Promise<void>(() => {})),
  snapshot: vi.fn(async () => null),
  reportDeviceInfo: vi.fn(async () => undefined),
}))
vi.mock("electron", () => ({
  powerMonitor: { on: () => {}, removeListener: () => {} },
  app: {
    isPackaged: false,
    whenReady: () => Promise.resolve(),
    on: vi.fn(),
    removeListener: vi.fn(),
    getPath: () => "/fixture",
    quit: vi.fn(),
  },
  BrowserWindow: Object.assign(
    class {
      webContents = { send: vi.fn() }
      constructor() {
        fixture.windows++
      }
      loadFile() {}
      once() {}
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
  createCallbackServer: async () => ({ close: vi.fn() }),
}))
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
it("creates checking window before an existing profile's remote inspect settles", async () => {
  await import("./index")
  await vi.waitFor(() => expect(fixture.inspect).toHaveBeenCalledOnce())
  expect(fixture.reportDeviceInfo).not.toHaveBeenCalled()
  expect(fixture.windows).toBe(1)
})
