// 负责贯通真实入口、回环 HTTP、composition、IPC 与 preload，验证授权结果及本机退出。
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it, vi } from "vitest"
import type { AuthorizationStateEvent } from "./authorization/types"
import type { PigclaudeBridge } from "../preload/index"
import { FileSecretVault } from "./secret-vault"
import { fixtureSafeStorage, seedProfile } from "./testing/profile-fixture"

const fixture = vi.hoisted(() => ({
  directory: "",
  contextFailure: false,
  exchangeFailure: false,
  redirectUri: "",
  closeCallback: async (): Promise<void> => undefined,
  opening: undefined as ((url: string) => Promise<void>) | undefined,
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
  appEvents: new Map<string, (event: { preventDefault: () => void }) => void>(),
  powerEvents: new Map<string, () => void>(),
  ready: (): void => undefined,
  callback: async (url: string): Promise<Pick<AuthorizationStateEvent, "status"> | null> => {
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
    on: (name: string, listener: (event: { preventDefault: () => void }) => void) =>
      fixture.appEvents.set(name, listener),
    removeListener: (name: string) => fixture.appEvents.delete(name),
    getPath: () => fixture.directory,
    quit: () => {},
  },
  BrowserWindow: Object.assign(
    class {
      webContents = {
        on: vi.fn(),
        setWindowOpenHandler: vi.fn(),
        isDestroyed: () => false,
        mainFrame: {},
        send: (channel: string, value: unknown) => fixture.listeners.get(channel)?.({}, value),
      }
      constructor() {
        fixture.windows.push(this)
        fixture.ready()
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
  screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }) },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`fixture-encrypted:${value}`),
    decryptString: (value: Buffer) => value.toString().slice("fixture-encrypted:".length),
  },
  shell: {
    openExternal: async (url: string) => {
      await fixture.opening?.(url)
    },
  },
}))
vi.mock("./updates/app-updates", () => import("./testing/inert-app-updates"))
vi.mock("./login-shell-path", () => ({ applyLoginShellPath: async () => undefined }))
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
vi.mock("./authorization/callback-server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./authorization/callback-server")>()
  return {
    createCallbackServer: async (handler: Parameters<typeof actual.createCallbackServer>[0]) => {
      fixture.callback = handler
      const server = await actual.createCallbackServer(handler)
      fixture.redirectUri = server.redirectUri
      let closing: Promise<void> | undefined
      fixture.closeCallback = () => (closing ??= server.close())
      return { redirectUri: server.redirectUri, close: fixture.closeCallback }
    },
  }
})

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
  const localFetch = globalThis.fetch
  let recoveryReads = 0
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
    if (url.pathname === "/v1/desktop/recovery") {
      recoveryReads++
      onSession()
      return Response.json({
        ...session,
        account: { userId: session.userId, nickname: "", email: "", avatar: "" },
        membership: {
          status: "active",
          tier: { code: "vip", name: "VIP", level: 1 },
          validUntil: null,
        },
        grantExpiresAt: "2030-01-01T00:00:00Z",
        canRevoke: true,
      })
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
        tier: { code: "vip", name: "VIP", level: 1 },
        status: "active",
        validUntil: null,
        entitlementVersion: "1",
      })
    if (url.pathname === "/v1/desktop/session") {
      onSession()
      return Response.json(session)
    }
    if (url.pathname === "/v1/desktop/oauth/contexts") {
      if (fixture.contextFailure) return Response.json({ error: "server_error" }, { status: 503 })
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
    if (url.pathname === "/oauth2/token") {
      if (fixture.exchangeFailure) return Response.json({ error: "server_error" }, { status: 500 })
      return Response.json({
        access_token: "ipc-access",
        refresh_token: "ipc-refresh",
        token_type: "Bearer",
        expires_in: 300,
        scope: "user:read membership:read device:inspect device:revoke",
      })
    }
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
    const authorizationEvents: AuthorizationStateEvent[] = []
    const unsubscribeAuthorization = bridge.authorization.subscribe((event) =>
      authorizationEvents.push(event),
    )

    const preserved = await vault.get("membership:session")
    const cancelled = await bridge.authorization.start({
      purpose: "pigclaude-login",
      mode: "switch",
    })
    if (!cancelled.ok) throw new Error("fixture cancellation did not start")
    const cancelledState = new URL(cancelled.authorizationUrl).searchParams.get("state")
    const cancellationPage = await (
      await localFetch(`${fixture.redirectUri}?error=access_denied&state=${cancelledState}`)
    ).text()
    expect(cancellationPage).toContain("授权未完成")
    expect(cancellationPage).not.toContain("授权完成")
    expect(await vault.get("membership:session")).toBe(preserved)

    const failed = await bridge.authorization.start({ purpose: "pigclaude-login", mode: "switch" })
    if (!failed.ok) throw new Error("fixture failure did not start")
    fixture.exchangeFailure = true
    const failedCodeState = new URL(failed.authorizationUrl).searchParams.get("state")
    const failurePage = await (
      await localFetch(`${fixture.redirectUri}?code=fixture&state=${failedCodeState}`)
    ).text()
    expect(failurePage).toContain("授权未完成")
    expect(failurePage).not.toContain("授权完成")
    expect(await vault.get("membership:session")).toBe(preserved)
    fixture.exchangeFailure = false
    let failedUrl = ""
    fixture.opening = async (url) => {
      failedUrl = url
      throw new Error("fixture browser failed")
    }
    expect(
      await bridge.authorization.start({
        purpose: "pigclaude-login",
        mode: "switch",
        clientRequestId: "failed-open",
      }),
    ).toMatchObject({ ok: false })
    const failedState = new URL(failedUrl).searchParams.get("state")
    await fixture.callback(`${fixture.redirectUri}?code=fixture&state=${failedState}`)
    expect(await vault.get("membership:session")).toBe(preserved)
    fixture.opening = async () => undefined
    const beforeFailureReads = recoveryReads
    fixture.contextFailure = true
    expect(
      await bridge.authorization.start({
        purpose: "pigclaude-login",
        mode: "switch",
        clientRequestId: "failed-prepare",
      }),
    ).toMatchObject({ ok: false })
    expect(recoveryReads).toBeGreaterThan(beforeFailureReads)
    expect(await vault.get("membership:session")).toBe(preserved)
    fixture.contextFailure = false
    let signal!: () => void
    let failOld!: () => void
    const entered = new Promise<void>((resolve) => {
      signal = resolve
    })
    const release = new Promise<void>((resolve) => {
      failOld = resolve
    })
    let openings = 0
    fixture.opening = async () => {
      if (++openings === 1) {
        signal()
        await release
        throw new Error("late old launch failure")
      }
    }
    const oldOpening = bridge.authorization.start({
      purpose: "pigclaude-login",
      mode: "switch",
      clientRequestId: "old-open-race",
    })
    await entered
    const freshOpening = await bridge.authorization.start({
      purpose: "pigclaude-login",
      mode: "switch",
      clientRequestId: "new-open-race",
    })
    expect(freshOpening.ok).toBe(true)
    failOld()
    expect(await oldOpening).toMatchObject({ ok: false })
    if (!freshOpening.ok) throw new Error("fresh launch failed")
    const freshState = new URL(freshOpening.authorizationUrl).searchParams.get("state")
    const beforeStaleCallbacks = authorizationEvents.length
    for (const query of [
      `error=access_denied&state=${failedState}`,
      `code=fixture&state=${failedState}`,
    ]) {
      const stalePage = await (await localFetch(`${fixture.redirectUri}?${query}`)).text()
      expect(stalePage).toContain("授权未完成")
      expect(authorizationEvents.slice(beforeStaleCallbacks)).toEqual([])
    }
    const completedPage = await (
      await localFetch(`${fixture.redirectUri}?code=fixture&state=${freshState}`)
    ).text()
    expect(completedPage).toContain("授权完成")
    expect(completedPage).not.toContain("授权未完成")
    expect(authorizationEvents.slice(beforeStaleCallbacks).map((event) => event.status)).toEqual([
      "exchanging",
      "committing",
      "completed",
    ])
    expect(await vault.get("membership:session")).toContain("ipc-refresh")
    fixture.opening = async () => undefined

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
    const invalidPage = await (
      await localFetch(`${fixture.redirectUri}?code=fixture&state=wrong-state`)
    ).text()
    expect(invalidPage).toContain("授权未完成")
    const successPage = await (
      await localFetch(`${fixture.redirectUri}?code=fixture&state=${state}`)
    ).text()
    expect(successPage).toContain("授权完成")
    expect(await bridge.membership.inspect()).toMatchObject({ state: "active" })
    expect(await vault.get("membership:session")).toContain("ipc-refresh")
    for (const event of ["browser-window-focus", "resume"]) {
      const entered = new Promise<void>((resolve) => {
        onSession = resolve
      })
      if (event === "resume") fixture.powerEvents.get(event)?.()
      else fixture.appEvents.get(event)?.({ preventDefault: () => undefined })
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
    const currentView = await bridge.membership.inspect()
    const context = currentView?.actionContextId
    if (!context) throw new Error("missing current context")
    await expect(
      handler({
        sender: fixture.windows[0]!.webContents,
        senderFrame: fixture.windows[0]!.webContents.mainFrame,
      }),
    ).rejects.toThrow("UNTRUSTED_MEMBERSHIP_REQUEST")
    const confirmation = await bridge.membership.prepareWithdrawal(context)
    expect(withdrawals).toBe(0)
    expect(await bridge.membership.withdraw(confirmation.confirmationId)).toMatchObject({
      state: "signed_out",
    })
    expect(withdrawals).toBe(1)
    expect(await vault.get("authorization:claude-account:other-account")).toBe("old-claude-secret")
    fixture.appEvents.get("before-quit")?.({ preventDefault: () => undefined })
    expect(fixture.powerEvents.has("resume")).toBe(false)
    expect(fixture.appEvents.has("browser-window-focus")).toBe(false)
    unsubscribe()
    unsubscribeAuthorization()
  } finally {
    await fixture.closeCallback()
    vi.unstubAllGlobals()
    await rm(directory, { recursive: true, force: true })
  }
})
