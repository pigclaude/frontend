// 负责验证真实启动链在系统标识读取失败时仅向日志和 IPC 暴露固定错误。
import { expect, it, vi } from "vitest"
const fixture = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  callbacks: vi.fn(),
  raw: "01234567-89AB-CDEF-0123-456789ABCDEF",
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
      loadFile() {}
      once() {}
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
      throw Object.assign(new Error(fixture.raw), { stdout: fixture.raw, stderr: fixture.raw })
    },
  }),
}))
vi.mock("./secret-vault", () => ({ FileSecretVault: class {} }))
vi.mock("./authorization/callback-server", () => ({ createCallbackServer: fixture.callbacks }))
vi.mock("./window-options", () => ({
  createMainWindowOptions: () => ({}),
  developmentRendererUrl: () => undefined,
  glassBackgroundColor: () => undefined,
  readThemeSource: () => undefined,
}))
it("preserves DEVICE_ID_UNAVAILABLE through startup and IPC without system data or network", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined)
  try {
    await import("./index")
    await vi.waitFor(() => expect(log.mock.calls).toEqual([["DEVICE_ID_UNAVAILABLE"]]))
    const result = await fixture.handlers.get("pigclaude:authorization-start")?.(
      {},
      { purpose: "pigclaude-login", mode: "login" },
    )
    expect(result).toEqual({ ok: false, status: "network-error", error: "DEVICE_ID_UNAVAILABLE" })
    expect(JSON.stringify(result) + JSON.stringify(log.mock.calls)).not.toContain(fixture.raw)
    expect(fixture.callbacks).not.toHaveBeenCalled()
  } finally {
    log.mockRestore()
  }
})
