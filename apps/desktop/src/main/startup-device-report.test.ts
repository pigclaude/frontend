// 负责验证启动上报只在已有授权时执行一次，失败只写日志且不重试。
import { afterEach, expect, it, vi } from "vitest"

const fixture = vi.hoisted(() => ({
  snapshot: vi.fn(),
  run: vi.fn(),
  readDeviceInfo: vi.fn(),
  reportDeviceInfo: vi.fn(),
}))
const info = { name: "Lin 的 MacBook Pro", osVersion: "macOS 15.4", appVersion: "1.3.0" }

vi.mock("electron", () => ({
  powerMonitor: { on: () => {}, removeListener: () => {} },
  app: {
    isPackaged: false,
    whenReady: () => Promise.resolve(),
    on: vi.fn(),
    removeListener: vi.fn(),
    getPath: () => "/fixture",
    quit: vi.fn(),
    getVersion: () => "1.3.0",
  },
  BrowserWindow: Object.assign(
    class {
      webContents = { send: vi.fn() }
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
vi.mock("./device-identity/device-info", () => ({ readDeviceInfo: fixture.readDeviceInfo }))
vi.mock("./secret-vault", () => ({ FileSecretVault: class {} }))
vi.mock("./authorization/callback-server", () => ({
  createCallbackServer: async () => ({ close: vi.fn() }),
}))
vi.mock("./composition", () => ({
  createDesktopComposition: () => ({
    authorizationService: {},
    membershipGate: { inspect: async () => undefined },
    tokenManager: { snapshot: fixture.snapshot, run: fixture.run },
    api: { reportDeviceInfo: fixture.reportDeviceInfo },
  }),
}))
vi.mock("./window-options", () => ({
  createMainWindowOptions: () => ({}),
  developmentRendererUrl: () => undefined,
  glassBackgroundColor: () => undefined,
  readThemeSource: () => undefined,
}))

afterEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
})

it("reports device info once when an authorization exists", async () => {
  fixture.snapshot.mockResolvedValue({ owner: 1, record: { accessToken: "pc_at_startup" } })
  fixture.run.mockImplementation(async (operation) =>
    operation({ owner: 1, record: { accessToken: "pc_at_startup" } }),
  )
  fixture.readDeviceInfo.mockResolvedValue(info)
  fixture.reportDeviceInfo.mockResolvedValue(undefined)
  await import("./index")
  await vi.waitFor(() => expect(fixture.reportDeviceInfo).toHaveBeenCalledOnce())
  expect(fixture.readDeviceInfo).toHaveBeenCalledOnce()
  expect(fixture.reportDeviceInfo).toHaveBeenCalledExactlyOnceWith(info, "pc_at_startup")
})

it("refreshes an expired access token before reporting", async () => {
  fixture.snapshot.mockResolvedValue({ owner: 1, record: { accessToken: "pc_at_expired" } })
  fixture.run.mockImplementation(async (operation) =>
    operation({ owner: 1, record: { accessToken: "pc_at_refreshed" } }),
  )
  fixture.readDeviceInfo.mockResolvedValue(info)
  fixture.reportDeviceInfo.mockResolvedValue(undefined)
  await import("./index")
  await vi.waitFor(() => expect(fixture.reportDeviceInfo).toHaveBeenCalledOnce())
  expect(fixture.run).toHaveBeenCalledOnce()
  expect(fixture.reportDeviceInfo).toHaveBeenCalledExactlyOnceWith(info, "pc_at_refreshed")
})

it("skips reporting when there is no authorization", async () => {
  fixture.snapshot.mockResolvedValue(null)
  await import("./index")
  await vi.waitFor(() => expect(fixture.snapshot).toHaveBeenCalledOnce())
  expect(fixture.readDeviceInfo).not.toHaveBeenCalled()
  expect(fixture.reportDeviceInfo).not.toHaveBeenCalled()
})

it("logs a failed report without retrying", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined)
  try {
    fixture.snapshot.mockResolvedValue({ owner: 1, record: { accessToken: "pc_at_startup" } })
    fixture.run.mockImplementation(async (operation) =>
      operation({ owner: 1, record: { accessToken: "pc_at_startup" } }),
    )
    fixture.readDeviceInfo.mockResolvedValue(info)
    fixture.reportDeviceInfo.mockRejectedValue(new Error("report failed"))
    await import("./index")
    await vi.waitFor(() => expect(fixture.reportDeviceInfo).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(log).toHaveBeenCalledWith("report failed"))
    expect(fixture.reportDeviceInfo).toHaveBeenCalledOnce()
  } finally {
    log.mockRestore()
  }
})
