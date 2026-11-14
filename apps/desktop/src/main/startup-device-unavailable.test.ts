// 负责验证系统标识读取失败时启动照常完成，登录时重新读取，日志和 IPC 只暴露固定错误。
import { expect, it, vi } from "vitest"
import type { SecretVault } from "./secret-vault"
import type { DeviceIdentityService } from "./device-identity"
const fixture = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  raw: "01234567-89AB-CDEF-0123-456789ABCDEF",
  machineIdReads: 0,
  windows: 0,
  inspect: vi.fn(async () => undefined),
  prepare: vi.fn(),
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
      once() {}
      on() {}
      setBackgroundColor() {}
    },
    { getAllWindows: () => [] },
  ),
  dialog: {},
  ipcMain: {
    handle: (name: string, handler: (...args: unknown[]) => unknown) =>
      fixture.handlers.set(name, handler),
  },
  nativeTheme: { on: vi.fn() },
  screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }) },
  safeStorage: {},
  shell: {},
}))
vi.mock("./login-shell-path", () => ({ applyLoginShellPath: async () => undefined }))
vi.mock("./runtime-profile", () => ({ configureRuntimeProfile: () => true }))
vi.mock("./runtime-endpoints", () => ({
  readDesktopRuntimeEndpoints: () => ({
    rustBaseUrl: "http://127.0.0.1:8789",
    authOrigin: "http://127.0.0.1:8788",
  }),
}))
vi.mock("./device-identity/platform-reader", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./device-identity/platform-reader")>()),
  createPlatformMachineIdReader: () => ({
    read: async () => {
      fixture.machineIdReads++
      throw Object.assign(new Error(fixture.raw), { stdout: fixture.raw, stderr: fixture.raw })
    },
  }),
}))
vi.mock("./secret-vault", () => ({ FileSecretVault: class {} }))
vi.mock("./authorization/callback-server", () => ({
  createCallbackServer: async () => ({
    redirectUri: "http://127.0.0.1:43123/oauth/callback",
    close: vi.fn(),
  }),
}))
vi.mock("./composition", async () => {
  const { AuthorizationService } = await import("./authorization/service")
  return {
    createDesktopComposition: (options: {
      vault: SecretVault
      deviceIdentity: Pick<DeviceIdentityService, "read">
    }) => ({
      authorizationService: new AuthorizationService({
        authOrigin: "http://127.0.0.1:8788",
        vault: options.vault,
        deviceIdentity: options.deviceIdentity,
        deviceInfo: async () => ({ name: "fixture", osVersion: "macOS 15.4", appVersion: "1.3.0" }),
        exchangeCode: async () => {
          throw new Error("unused")
        },
        startAuthorization: fixture.prepare,
      }),
      membershipGate: { inspect: fixture.inspect },
      tokenManager: { snapshot: async () => null, run: vi.fn() },
      api: { reportDeviceInfo: vi.fn() },
    }),
  }
})
vi.mock("./window-options", () => ({
  createMainWindowOptions: () => ({}),
  developmentRendererUrl: () => undefined,
  glassBackgroundColor: () => undefined,
  readThemeSource: () => undefined,
}))
it("finishes startup without the machine identity and reports only DEVICE_ID_UNAVAILABLE", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined)
  try {
    await import("./index")
    await vi.waitFor(() => expect(fixture.inspect).toHaveBeenCalledOnce())
    expect(fixture.windows).toBe(1)
    await vi.waitFor(() => expect(log.mock.calls).toEqual([["DEVICE_ID_UNAVAILABLE"]]))
    const sender = { send: vi.fn() }
    const result = await fixture.handlers.get("pigclaude:authorization-start")?.(
      { sender },
      { purpose: "pigclaude-login", mode: "login" },
    )
    expect(result).toEqual({ ok: false, status: "network-error", error: "DEVICE_ID_UNAVAILABLE" })
    expect(fixture.machineIdReads).toBe(2)
    expect(fixture.prepare).not.toHaveBeenCalled()
    expect(
      JSON.stringify(result) +
        JSON.stringify(log.mock.calls) +
        JSON.stringify(sender.send.mock.calls),
    ).not.toContain(fixture.raw)
  } finally {
    log.mockRestore()
  }
})
