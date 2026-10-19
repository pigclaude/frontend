// 负责贯通真实入口、composition、IPC 与 preload，在临时安全仓库中验证本机退出。
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it, vi } from "vitest"
import type { PigclaudeBridge } from "../preload/index"
import { FileSecretVault } from "./secret-vault"
import { fixtureSafeStorage, seedProfile } from "./testing/profile-fixture"

const fixture = vi.hoisted(() => ({
  directory: "",
  bridge: undefined as unknown,
  handlers: new Map<
    string,
    (
      event: { senderFrame?: object; sender: { send: (channel: string, value: unknown) => void } },
      value?: unknown,
    ) => unknown
  >(),
  listeners: new Map<string, (event: unknown, value: unknown) => void>(),
  windows: [] as {
    webContents: { mainFrame: object; send: (channel: string, value: unknown) => void }
  }[],
  appEvents: new Map<string, () => void>(),
  powerEvents: new Map<string, () => void>(),
  ready: (): void => undefined,
  callback: async (url: string): Promise<void> => {
    throw new Error(`Callback invoked before setup: ${url}`)
  },
}))

vi.mock("electron", () => ({
  powerMonitor: {
    on: (name: string, listener: () => void) => fixture.powerEvents.set(name, listener),
    removeListener: (name: string) => fixture.powerEvents.delete(name),
  },
  app: {
    isPackaged: false,
    whenReady: () => Promise.resolve(),
    on: (name: string, listener: () => void) => fixture.appEvents.set(name, listener),
    removeListener: (name: string) => fixture.appEvents.delete(name),
    getPath: () => fixture.directory,
    quit: () => {},
  },
  BrowserWindow: Object.assign(
    class {
      webContents = {
        mainFrame: {},
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
        {
          sender: fixture.windows[0]!.webContents,
          senderFrame: fixture.windows[0]!.webContents.mainFrame,
        },
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
vi.mock("./device-identity", () => ({
  DeviceIdentityService: class {
    read = async () => ({ deviceId: "pcd_" + "1".repeat(64), platform: "darwin" })
  },
}))
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
  let inactive = false
  let withdrawals = 0
  let onSession = () => {}
  vi.stubGlobal("fetch", async (input: string | URL | Request, options?: RequestInit) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url)
    const session = {
      userId: "user-fixture",
      deviceId: "pcd_" + "1".repeat(64),
      bindingEpoch: "2",
      authVersion: "1",
    }
    if (url.pathname === "/v1/desktop/membership/inspect")
      return inactive
        ? Response.json({ error: "insufficient_scope" }, { status: 403 })
        : Response.json({ ...session, status: "active" })
    if (url.pathname === "/v1/desktop/devices/revoke") {
      withdrawals++
      expect(options?.body).toBe("{}")
      expect(new Headers(options?.headers).get("authorization")).toBe("Bearer ipc-access")
      return new Response(null, { status: 204 })
    }
    if (url.pathname === "/v1/desktop/entitlement")
      return Response.json({
        productCode: "pigclaude",
        planKind: "week",
        status: "active",
        lifetime: false,
        validUntil: null,
        termsVersion: "1",
        termsAcceptedAt: "2026-10-19T00:00:00Z",
        entitlementVersion: "1",
      })
    if (url.pathname === "/v1/desktop/session") {
      onSession()
      return Response.json(session)
    }
    if (url.pathname === "/v1/desktop/oauth/contexts") {
      const body = JSON.parse(String(options?.body)) as {
        state: string
        clientId: string
        redirectUri: string
        codeChallenge: string
        scopes: string[]
      }
      return Response.json({
        contextId: "context-ipc",
        authorizationUrl:
          "http://127.0.0.1:8788/oauth2/authorize?" +
          new URLSearchParams({
            response_type: "code",
            client_id: body.clientId,
            redirect_uri: body.redirectUri,
            code_challenge: body.codeChallenge,
            code_challenge_method: "S256",
            state: body.state,
            scope: body.scopes.join(" "),
            device_context: "context-ipc",
          }).toString(),
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      })
    }
    if (url.pathname === "/oauth2/token")
      return Response.json({
        access_token: "ipc-access",
        refresh_token: "ipc-refresh",
        token_type: "Bearer",
        expires_in: 300,
        scope: "user:read membership:read device:inspect device:revoke",
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
    expect(await vault.get("authorization:claude-account:other-account")).toBe("old-claude-secret")
    expect(await vault.get("device:identity")).toBe(identity)

    const started = await bridge.authorization.start({ purpose: "pigclaude-login", mode: "login" })
    expect(started.ok).toBe(true)
    if (!started.ok) throw new Error("Fixture authorization did not start")
    const state = new URL(started.authorizationUrl).searchParams.get("state")
    await fixture.callback(`http://127.0.0.1:43123/oauth/callback?code=fixture&state=${state}`)
    expect(await bridge.membership.inspect()).toMatchObject({ state: "active" })
    expect(await vault.get("membership:session")).toContain("ipc-refresh")
    for (const event of ["browser-window-focus", "resume"]) {
      const entered = new Promise<void>((resolve) => {
        onSession = resolve
      })
      const listeners = event === "resume" ? fixture.powerEvents : fixture.appEvents
      listeners.get(event)?.()
      await entered
    }
    inactive = true
    expect(await bridge.membership.inspect()).toMatchObject({
      state: "verification_required",
      account: { userId: "user-fixture" },
    })
    const handler = fixture.handlers.get("pigclaude:membership-withdraw")!
    await expect(handler({ sender: { send: () => {} } })).rejects.toThrow(
      "UNTRUSTED_MEMBERSHIP_REQUEST",
    )
    await expect(
      handler(
        {
          sender: fixture.windows[0]!.webContents,
          senderFrame: fixture.windows[0]!.webContents.mainFrame,
        },
        { deviceId: "forged" },
      ),
    ).rejects.toThrow("UNTRUSTED_MEMBERSHIP_REQUEST")
    expect(withdrawals).toBe(0)
    expect(await bridge.membership.withdraw()).toMatchObject({ state: "signed_out" })
    expect(withdrawals).toBe(1)
    expect(await vault.get("authorization:claude-account:other-account")).toBe("old-claude-secret")
    fixture.appEvents.get("before-quit")?.()
    expect(fixture.powerEvents.has("resume")).toBe(false)
    expect(fixture.appEvents.has("browser-window-focus")).toBe(false)
    unsubscribe()
  } finally {
    vi.unstubAllGlobals()
    await rm(directory, { recursive: true, force: true })
  }
})
