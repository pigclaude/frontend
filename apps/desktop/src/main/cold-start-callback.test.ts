// 负责从真实主进程首 argv 接线验证合成回调；平台和系统端口替身不代表真实安装验收。
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import {
  activeCallbackReceptionUrl,
  callbackReceptionToken,
  createCallbackReceptionFixture,
  disposeCallbackReceptionFixture,
  emitCallbackReceptionArguments,
  emitCallbackReceptionUrl,
  finishCallbackReceptionStartup,
  invokeCallbackReceptionIpc,
  prepareCallbackReceptionUrl,
} from "./testing/callback-reception-fixture"
import { deferred, oauthSessionFixture } from "./testing/profile-fixture"
import { restoreColdStartProcess, setColdStartProcess } from "./testing/cold-start-process-fixture"

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-10-30T00:00:00Z"))
})

afterEach(async () => {
  await disposeCallbackReceptionFixture()
  restoreColdStartProcess()
  vi.clearAllTimers()
  vi.useRealTimers()
})

it.each([
  { platform: "win32", executable: "C:\\Program Files\\PigClaude\\PigClaude.exe" },
  { platform: "linux", executable: "/home/fixture/PigClaude client.AppImage" },
] as const)(
  "delivers the $platform startup callback before unrelated trailing arguments",
  async (input) => {
    const { fixture, service, vault, exchange } = createCallbackReceptionFixture()
    // 预先建立合成 pending 只用于判别接线，不代表重启后可以恢复授权事务。
    const callback = await prepareCallbackReceptionUrl(service)
    const sessionId = service.getActiveSession()?.sessionId
    setColdStartProcess(input.platform, [input.executable, "--fixture", callback, "tail"])
    await import("./index")
    await finishCallbackReceptionStartup()

    expect(exchange).toHaveBeenCalledOnce()
    expect(await vault.get("authorization:pigclaude-login:callback-fixture-user")).toContain(
      "callback-fixture-refresh",
    )
    expect(fixture.sent).toContainEqual({
      channel: "pigclaude:authorization-state",
      value: expect.objectContaining({ sessionId, status: "completed" }),
    })
  },
)

it.each(["win32", "linux"] as const)(
  "rejects a %s cold transaction with no pending request and permits a fresh main IPC authorization",
  async (platform) => {
    const { fixture, service, vault, exchange } = createCallbackReceptionFixture()
    const originalSession = JSON.stringify({
      ...oauthSessionFixture(),
      userId: "original-fixture-user",
      accessToken: "original-fixture-access",
      refreshToken: "original-fixture-refresh",
    })
    await vault.set("membership:session", originalSession)
    await vault.set("authorization:claude-account:sentinel", "independent-Claude-sentinel")
    const writes = vi.spyOn(vault, "set")
    const handling = vi.spyOn(service, "handleCallback")
    const old = "pigclaude://authorize/callback?code=old-code&state=old-state"
    setColdStartProcess(platform, ["/fixture/app path", old, "--after-callback"])
    await import("./index")
    await finishCallbackReceptionStartup()

    expect(handling).toHaveBeenCalledWith(old)
    const rejected = handling.mock.results[0]
    if (!rejected || rejected.type !== "return")
      throw new Error("fixture callback was not received")
    expect(await rejected.value).toMatchObject({ status: "state-mismatch", sessionId: "" })
    expect(exchange).not.toHaveBeenCalled()
    expect(writes).not.toHaveBeenCalled()
    expect(await vault.get("membership:session")).toBe(originalSession)
    expect(await vault.get("authorization:claude-account:sentinel")).toBe(
      "independent-Claude-sentinel",
    )
    expect(fixture.sent).toEqual([])

    exchange.mockResolvedValue({ ...callbackReceptionToken(), oauthSession: oauthSessionFixture() })
    expect(
      await invokeCallbackReceptionIpc("pigclaude:authorization-start", {
        purpose: "pigclaude-login",
        mode: "login",
      }),
    ).toMatchObject({ ok: true })
    const fresh = service.getActiveSession()?.sessionId
    const callback = activeCallbackReceptionUrl(service)
    fixture.sent.length = 0
    fixture.appEvents!.emit("activate")
    await vi.advanceTimersByTimeAsync(0)
    expect(handling).toHaveBeenCalledTimes(1)

    emitCallbackReceptionArguments(["/fixture/app", old])
    await vi.advanceTimersByTimeAsync(0)
    expect(service.getActiveSession()?.sessionId).toBe(fresh)
    expect(fixture.sent).toEqual([])
    emitCallbackReceptionUrl(callback)
    await vi.advanceTimersByTimeAsync(0)

    expect(exchange).toHaveBeenCalledOnce()
    expect(fixture.commits).toBe(1)
    expect(writes).toHaveBeenCalledOnce()
    expect(await vault.get("membership:session")).toContain("new-fixture-refresh")
    expect(fixture.sent).toContainEqual({
      channel: "pigclaude:authorization-state",
      value: expect.objectContaining({ sessionId: fresh, status: "completed" }),
    })
    const committed = await vault.get("membership:session")
    emitCallbackReceptionArguments(["/fixture/app", old])
    await vi.advanceTimersByTimeAsync(0)
    expect(await vault.get("membership:session")).toBe(committed)
    expect(exchange).toHaveBeenCalledOnce()
  },
)

it("captures initial arguments once and lets the service consume duplicate OS input only once", async () => {
  const { fixture, service, vault, exchange } = createCallbackReceptionFixture()
  const callback = await prepareCallbackReceptionUrl(service)
  const handling = vi.spyOn(service, "handleCallback")
  const writes = vi.spyOn(vault, "set")
  setColdStartProcess("linux", ["/home/fixture/PigClaude client.AppImage", callback, "tail"])
  await import("./index")
  setColdStartProcess("linux", [
    "/fixture/app",
    "pigclaude://authorize/callback?code=later&state=later",
  ])
  emitCallbackReceptionArguments(["/fixture/app path", "--before", callback])
  await finishCallbackReceptionStartup()
  fixture.appEvents!.emit("activate")
  fixture.ready!.resolve(undefined)
  await vi.advanceTimersByTimeAsync(0)

  expect(handling.mock.calls.map(([value]) => value)).toEqual([callback, callback])
  expect(exchange).toHaveBeenCalledOnce()
  expect(writes).toHaveBeenCalledOnce()
  expect(vault.values.size).toBe(1)
  expect(
    fixture.sent.filter(
      ({ value }) =>
        typeof value === "object" &&
        value !== null &&
        "status" in value &&
        value.status === "completed",
    ),
  ).toHaveLength(1)
})

it("leaves Mac startup arguments alone while preserving its existing open-url reception", async () => {
  const { service, vault, exchange } = createCallbackReceptionFixture()
  const callback = await prepareCallbackReceptionUrl(service)
  const handling = vi.spyOn(service, "handleCallback")
  setColdStartProcess("darwin", ["/fixture/App.app", callback])
  await import("./index")
  await finishCallbackReceptionStartup()

  expect(handling).not.toHaveBeenCalled()
  expect(exchange).not.toHaveBeenCalled()
  expect(vault.values.size).toBe(0)
  emitCallbackReceptionUrl(callback)
  await vi.advanceTimersByTimeAsync(0)
  expect(exchange).toHaveBeenCalledOnce()
})

it("never consumes startup arguments in a Windows instance that did not acquire the lock", async () => {
  const { fixture, service, vault, exchange } = createCallbackReceptionFixture()
  const callback = await prepareCallbackReceptionUrl(service)
  const handling = vi.spyOn(service, "handleCallback")
  fixture.hasLock = false
  setColdStartProcess("win32", ["C:\\Program Files\\PigClaude\\PigClaude.exe", callback])
  await import("./index")
  fixture.ready!.resolve(undefined)
  await vi.advanceTimersByTimeAsync(0)

  expect(handling).not.toHaveBeenCalled()
  expect(exchange).not.toHaveBeenCalled()
  expect(vault.values.size).toBe(0)
  expect(fixture.setupEntered).toBe(0)
  expect(fixture.windows).toHaveLength(0)
  expect(fixture.appEvents!.listenerCount("open-url")).toBe(0)
  expect(fixture.appEvents!.listenerCount("second-instance")).toBe(0)
  expect(fixture.quitCalls).toBe(1)
})

it("uses the same first-admissible-candidate rule for startup and later instance arguments", async () => {
  const { service, vault, exchange } = createCallbackReceptionFixture()
  const callback = await prepareCallbackReceptionUrl(service)
  const sessionId = service.getActiveSession()?.sessionId
  const first = "pigclaude://authorize/callback?code=foreign&state=foreign"
  const handling = vi.spyOn(service, "handleCallback")
  setColdStartProcess("linux", ["/fixture/app", "https://unrelated.invalid", first, callback])
  await import("./index")
  await finishCallbackReceptionStartup()

  expect(handling.mock.calls.map(([value]) => value)).toEqual([first])
  expect(service.getActiveSession()?.sessionId).toBe(sessionId)
  expect(exchange).not.toHaveBeenCalled()
  expect(vault.values.size).toBe(0)
  emitCallbackReceptionArguments(["/fixture/app", "file:///unrelated", callback, "tail"])
  await vi.advanceTimersByTimeAsync(0)
  expect(exchange).toHaveBeenCalledOnce()
})

it.each([
  { label: "foreign state", change: (url: string) => url.replace(/state=[^&]+/, "state=foreign") },
  { label: "duplicate state", change: (url: string) => `${url}&state=duplicate` },
  { label: "duplicate code", change: (url: string) => `${url}&code=duplicate` },
  { label: "unknown parameter", change: (url: string) => `${url}&unknown=extra` },
  { label: "fragment", change: (url: string) => `${url}#fragment` },
  {
    label: "wrong private path",
    change: (url: string) => url.replace("callback?", "callback/extra?"),
  },
  { label: "HTTP URL", change: () => "https://auth.fixture.invalid/callback?code=foreign" },
  { label: "file URL", change: () => "file:///fixture/callback?code=foreign" },
  { label: "ordinary startup argument", change: () => "--ordinary-startup" },
])("does not lend the pending transaction to a startup $label input", async ({ change }) => {
  const { fixture, service, vault, exchange } = createCallbackReceptionFixture()
  const valid = await prepareCallbackReceptionUrl(service)
  const sessionId = service.getActiveSession()?.sessionId
  setColdStartProcess("linux", ["/fixture/app path", change(valid)])
  await import("./index")
  await finishCallbackReceptionStartup()

  expect(exchange).not.toHaveBeenCalled()
  expect(vault.values.size).toBe(0)
  expect(fixture.sent).toEqual([])
  expect(service.getActiveSession()?.sessionId).toBe(sessionId)
  emitCallbackReceptionUrl(valid)
  await vi.advanceTimersByTimeAsync(0)
  expect(exchange).toHaveBeenCalledOnce()
})

it("preserves the raw startup callback instead of decoding and rebuilding its URL", async () => {
  const { service, exchange } = createCallbackReceptionFixture()
  const valid = await prepareCallbackReceptionUrl(service)
  const raw = valid.replace("callback-fixture-code", "kept%2Bplus%2fslash%252Fdouble")
  const handling = vi.spyOn(service, "handleCallback")
  setColdStartProcess("win32", ["C:\\Program Files\\PigClaude\\PigClaude.exe", raw])
  await import("./index")
  await finishCallbackReceptionStartup()

  expect(handling.mock.calls.map(([value]) => value)).toEqual([raw])
  expect(exchange).toHaveBeenCalledOnce()
})

it("uses the existing expiry decision for a synthetic old transaction without preventing a fresh one", async () => {
  const { fixture, service, vault, exchange } = createCallbackReceptionFixture()
  const expired = await prepareCallbackReceptionUrl(service)
  const handling = vi.spyOn(service, "handleCallback")
  await vi.advanceTimersByTimeAsync(600_001)
  setColdStartProcess("linux", ["/fixture/app path", expired])
  await import("./index")
  await finishCallbackReceptionStartup()

  expect(handling).toHaveBeenCalledWith(expired)
  const rejected = handling.mock.results[0]
  if (!rejected || rejected.type !== "return") throw new Error("fixture expiry was not evaluated")
  expect(await rejected.value).toMatchObject({ status: "expired" })
  expect(exchange).not.toHaveBeenCalled()
  expect(vault.values.size).toBe(0)
  expect(service.getActiveSession()).toBeNull()
  await invokeCallbackReceptionIpc("pigclaude:authorization-start", {
    purpose: "pigclaude-login",
    mode: "login",
  })
  const fresh = service.getActiveSession()?.sessionId
  fixture.sent.length = 0
  emitCallbackReceptionUrl(activeCallbackReceptionUrl(service))
  await vi.advanceTimersByTimeAsync(0)
  expect(exchange).toHaveBeenCalledOnce()
  expect(fixture.sent).toContainEqual({
    channel: "pigclaude:authorization-state",
    value: expect.objectContaining({ sessionId: fresh, status: "completed" }),
  })
})

it.each([false, true])(
  "applies the shared UTF-8 startup URL limit with oversized=%s",
  async (oversized) => {
    const { service, vault, exchange } = createCallbackReceptionFixture()
    const valid = await prepareCallbackReceptionUrl(service)
    const codeBytes = 8_192 - Buffer.byteLength(valid.replace("callback-fixture-code", ""), "utf8")
    const code = "界".repeat(Math.floor(codeBytes / 3)) + "a".repeat(codeBytes % 3)
    const exact = valid.replace("callback-fixture-code", code)
    const input = oversized ? exact.replace("code=", "code=界") : exact
    expect(Buffer.byteLength(input, "utf8")).toBe(oversized ? 8_195 : 8_192)
    const handling = vi.spyOn(service, "handleCallback")
    setColdStartProcess("linux", ["/fixture/app path", input])
    await import("./index")
    await finishCallbackReceptionStartup()

    if (oversized) {
      expect(handling).not.toHaveBeenCalled()
      expect(exchange).not.toHaveBeenCalled()
      expect(vault.values.size).toBe(0)
      emitCallbackReceptionUrl(exact)
      await vi.advanceTimersByTimeAsync(0)
    } else {
      expect(handling).toHaveBeenCalledWith(exact)
    }
    expect(exchange).toHaveBeenCalledOnce()
  },
)

it("expires queued startup input without expiring its still-valid authorization transaction", async () => {
  const { service, vault, exchange } = createCallbackReceptionFixture()
  const callback = await prepareCallbackReceptionUrl(service)
  const handling = vi.spyOn(service, "handleCallback")
  setColdStartProcess("linux", ["/fixture/app path", callback])
  await import("./index")
  await vi.advanceTimersByTimeAsync(60_001)
  await finishCallbackReceptionStartup()

  expect(handling).not.toHaveBeenCalled()
  expect(exchange).not.toHaveBeenCalled()
  expect(vault.values.size).toBe(0)
  expect(service.getActiveSession()).not.toBeNull()
  emitCallbackReceptionUrl(callback)
  await vi.advanceTimersByTimeAsync(0)
  expect(exchange).toHaveBeenCalledOnce()
})

it.each(["before-service", "after-service"])(
  "does not let captured startup input bypass a failed setup at %s",
  async (stage) => {
    const { fixture, service, vault, exchange } = createCallbackReceptionFixture()
    const callback = await prepareCallbackReceptionUrl(service)
    const handling = vi.spyOn(service, "handleCallback")
    fixture.setupFailure = stage === "before-service"
    fixture.screenFailure = stage === "after-service"
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined)
    setColdStartProcess("linux", ["/fixture/app path", callback])
    try {
      await import("./index")
      await finishCallbackReceptionStartup()

      expect(handling).not.toHaveBeenCalled()
      expect(exchange).not.toHaveBeenCalled()
      expect(vault.values.size).toBe(0)
      expect(fixture.appEvents!.listenerCount("open-url")).toBe(0)
      expect(fixture.appEvents!.listenerCount("second-instance")).toBe(0)
      expect(
        await invokeCallbackReceptionIpc("pigclaude:authorization-start", {
          purpose: "pigclaude-login",
          mode: "login",
        }),
      ).toMatchObject({ ok: false, status: "network-error" })
      expect(JSON.stringify(log.mock.calls)).not.toContain(callback)
      expect(fixture.sent).toEqual([])
    } finally {
      log.mockRestore()
    }
  },
)

it("discards captured startup input when quit happens before app readiness", async () => {
  const { fixture, service, vault, exchange } = createCallbackReceptionFixture()
  const callback = await prepareCallbackReceptionUrl(service)
  const handling = vi.spyOn(service, "handleCallback")
  setColdStartProcess("win32", ["C:\\Program Files\\PigClaude\\PigClaude.exe", callback])
  await import("./index")
  await disposeCallbackReceptionFixture()
  fixture.ready!.resolve(undefined)
  await vi.advanceTimersByTimeAsync(0)

  expect(handling).not.toHaveBeenCalled()
  expect(exchange).not.toHaveBeenCalled()
  expect(vault.values.size).toBe(0)
  expect(fixture.setupEntered).toBe(0)
  expect(fixture.windows).toHaveLength(0)
  expect(fixture.appEvents!.listenerCount("open-url")).toBe(0)
})

it("does not revive startup input when a blocked setup finishes after quit", async () => {
  const { fixture, service, vault, exchange } = createCallbackReceptionFixture()
  const callback = await prepareCallbackReceptionUrl(service)
  const handling = vi.spyOn(service, "handleCallback")
  const gate = deferred<void>()
  fixture.deviceReadGate = gate
  setColdStartProcess("linux", ["/fixture/PigClaude client.AppImage", callback])
  await import("./index")
  fixture.ready!.resolve(undefined)
  await vi.advanceTimersByTimeAsync(0)
  expect(fixture.deviceReads).toBe(1)
  await disposeCallbackReceptionFixture()
  gate.resolve(undefined)
  await vi.advanceTimersByTimeAsync(0)

  expect(handling).not.toHaveBeenCalled()
  expect(exchange).not.toHaveBeenCalled()
  expect(vault.values.size).toBe(0)
  expect(fixture.windows).toHaveLength(0)
  expect(fixture.closeCalls).toBeGreaterThanOrEqual(fixture.callbackCreates)
  expect(fixture.compositionDisposals).toBeGreaterThanOrEqual(fixture.setupEntered)
})
