// 负责贯通真实入口、composition、IPC 与 preload，在临时安全仓库中验证本机退出。
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it, vi } from "vitest"
import type { PigclaudeBridge } from "../preload/index"
import { FileSecretVault } from "./secret-vault"
import { fixtureSafeStorage, membershipView, seedProfile } from "./testing/profile-fixture"

const fixture = vi.hoisted(() => ({
  directory: "",
  bridge: undefined as unknown,
  handlers: new Map<
    string,
    (
      event: { sender: { send: (channel: string, value: unknown) => void } },
      value?: unknown,
    ) => unknown
  >(),
  listeners: new Map<string, (event: unknown, value: unknown) => void>(),
  windows: [] as { webContents: { send: (channel: string, value: unknown) => void } }[],
  ready: (): void => undefined,
  callback: async (url: string): Promise<void> => {
    throw new Error(`Callback invoked before setup: ${url}`)
  },
}))

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    whenReady: () => Promise.resolve(),
    on: () => {},
    getPath: () => fixture.directory,
    quit: () => {},
  },
  BrowserWindow: Object.assign(
    class {
      webContents = {
        send: (channel: string, value: unknown) => fixture.listeners.get(channel)?.({}, value),
      }
      constructor() {
        fixture.windows.push(this)
        fixture.ready()
      }
      loadFile() {}
      once() {}
      setBackgroundColor() {}
      show() {}
      focus() {}
    },
    { getAllWindows: () => fixture.windows },
  ),
  dialog: {},
  ipcMain: {
    handle: (
      channel: string,
      handler: typeof fixture.handlers extends Map<string, infer H> ? H : never,
    ) => fixture.handlers.set(channel, handler),
  },
  ipcRenderer: {
    invoke: async (channel: string, value?: unknown) => {
      const handler = fixture.handlers.get(channel)
      if (!handler) throw new Error(`Missing IPC handler: ${channel}`)
      return handler(
        { sender: { send: (event, payload) => fixture.listeners.get(event)?.({}, payload) } },
        value,
      )
    },
    on: (channel: string, handler: (event: unknown, value: unknown) => void) =>
      fixture.listeners.set(channel, handler),
    removeListener: (channel: string) => fixture.listeners.delete(channel),
  },
  contextBridge: {
    exposeInMainWorld: (_name: string, bridge: unknown) => (fixture.bridge = bridge),
  },
  nativeTheme: { on: () => {}, shouldUseDarkColors: false },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`fixture-encrypted:${value}`),
    decryptString: (value: Buffer) => value.toString().slice("fixture-encrypted:".length),
  },
  shell: { openExternal: async () => undefined },
}))
vi.mock("./runtime-profile", () => ({ configureRuntimeProfile: () => true }))
vi.mock("./runtime-endpoints", () => ({
  readDesktopRuntimeEndpoints: () => ({
    rustBaseUrl: "http://127.0.0.1:8789",
    authOrigin: "http://127.0.0.1:8788",
  }),
}))
vi.mock("./authorization/callback-server", () => ({
  createCallbackServer: async (handler: (url: string) => Promise<void>) => {
    fixture.callback = handler
    return { redirectUri: "http://127.0.0.1:43123/oauth/callback", close: async () => {} }
  },
}))

it("preload sign-out clears real vault keys and broadcasts authoritative signed_out without remote logout", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pigclaude-sign-out-ipc-"))
  fixture.directory = directory
  const vault = new FileSecretVault(
    join(directory, "authorization-secrets.json"),
    fixtureSafeStorage,
  )
  await seedProfile(vault)
  const identity = JSON.stringify({
    deviceId: "device-fixture",
    deviceFingerprintHash: "fingerprint-fixture",
  })
  await vault.set("device:identity", identity)
  vi.stubGlobal("fetch", async (input: string | URL | Request, options?: RequestInit) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url)
    if (url.pathname === "/v1/desktop/membership/inspect") return Response.json(membershipView())
    if (url.pathname === "/v1/desktop/authorizations/start") {
      const body = JSON.parse(String(options?.body)) as { state: string }
      return Response.json({
        flowId: "flow-ipc",
        authorizationUrl: `/authorize/flow-ipc?state=${body.state}`,
        expiresAt: Date.now() + 600_000,
      })
    }
    if (url.pathname === "/v1/desktop/authorizations/exchange")
      return Response.json({
        deviceId: "device-fixture",
        bindingEpoch: "2",
        userId: "user-fixture",
        sessionCookie: "ipc-cookie",
      })
    throw new Error(`Unexpected remote operation: ${url.pathname}`)
  })
  try {
    const ready = new Promise<void>((resolve) => (fixture.ready = resolve))
    await import("./index")
    await ready
    await import("../preload/index")
    const bridge = fixture.bridge as PigclaudeBridge
    expect(await bridge.membership.inspect()).toMatchObject({ state: "active" })
    const events: string[] = []
    const unsubscribe = bridge.membership.subscribe((view) => events.push(view.state))

    expect(await bridge.membership.signOut()).toMatchObject({ state: "signed_out" })
    expect(await bridge.membership.inspect()).toMatchObject({ state: "signed_out" })
    expect(events.at(-1)).toBe("signed_out")
    expect(await vault.get("membership:session")).toBeNull()
    expect(await vault.get("authorization:pigclaude-login:old-user")).toBeNull()
    expect(await vault.get("authorization:claude-account:other-account")).toBeNull()
    expect(await vault.get("device:identity")).toBe(identity)

    const started = await bridge.authorization.start({ purpose: "pigclaude-login", mode: "login" })
    expect(started.ok).toBe(true)
    if (!started.ok) throw new Error("Fixture authorization did not start")
    const state = new URL(started.authorizationUrl).searchParams.get("state")
    await fixture.callback(`http://127.0.0.1:43123/oauth/callback?code=fixture&state=${state}`)
    expect(await bridge.membership.inspect()).toMatchObject({ state: "active" })
    expect(await vault.get("membership:session")).toContain("ipc-cookie")
    await bridge.membership.signOut()
    unsubscribe()
  } finally {
    vi.unstubAllGlobals()
    await rm(directory, { recursive: true, force: true })
  }
})
