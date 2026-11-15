// 负责通过真实主进程接线验证回调收件的启动时限、失败与退出边界。
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import {
  createCallbackReceptionFixture,
  disposeCallbackReceptionFixture,
  emitCallbackReceptionUrl,
  finishCallbackReceptionStartup,
  invokeCallbackReceptionIpc,
  prepareCallbackReceptionUrl,
} from "./testing/callback-reception-fixture"
import { deferred } from "./testing/profile-fixture"

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-10-30T00:00:00Z"))
})

afterEach(async () => {
  await disposeCallbackReceptionFixture()
  vi.clearAllTimers()
  vi.useRealTimers()
})

it("系统直接退出时也释放手动防休眠请求", async () => {
  const { fixture } = createCallbackReceptionFixture()
  const directory = await mkdtemp(join(tmpdir(), "pigclaude-awake-system-quit-"))
  fixture.userData = directory
  try {
    await import("./index")
    await finishCallbackReceptionStartup()
    await expect(invokeCallbackReceptionIpc("pigclaude:keep-awake-set", true)).resolves.toBe(true)
    expect(fixture.powerBlocker.start).toHaveBeenCalledExactlyOnceWith("prevent-app-suspension")

    const preventDefault = vi.fn()
    fixture.powerEvents!.emit("shutdown", { preventDefault })
    await vi.advanceTimersByTimeAsync(0)

    expect(preventDefault).toHaveBeenCalledOnce()
    expect(fixture.powerBlocker.stop).toHaveBeenCalledExactlyOnceWith(0)
    expect(fixture.quitCalls).toBe(1)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it("does not exchange a valid pending callback retained beyond the receiver's startup lifetime", async () => {
  const { service, vault, exchange } = createCallbackReceptionFixture()
  const url = await prepareCallbackReceptionUrl(service)
  await import("./index")
  emitCallbackReceptionUrl(url)

  await vi.advanceTimersByTimeAsync(60_001)
  await finishCallbackReceptionStartup()

  expect(exchange).not.toHaveBeenCalled()
  expect(vault.values.size).toBe(0)
  expect(service.getActiveSession()).not.toBeNull()
})

it("delivers a still-valid buffered callback through the real authorization service after startup", async () => {
  const { fixture, service, vault, exchange } = createCallbackReceptionFixture()
  const url = await prepareCallbackReceptionUrl(service)
  const sessionId = service.getActiveSession()?.sessionId
  await import("./index")
  emitCallbackReceptionUrl(url)

  await vi.advanceTimersByTimeAsync(59_999)
  expect(exchange).not.toHaveBeenCalled()
  await finishCallbackReceptionStartup()

  expect(exchange).toHaveBeenCalledOnce()
  expect(await vault.get("authorization:pigclaude-login:callback-fixture-user")).toContain(
    "callback-fixture-refresh",
  )
  expect(fixture.sent).toContainEqual({
    channel: "pigclaude:authorization-state",
    value: expect.objectContaining({ sessionId, status: "completed" }),
  })
})

it("never begins setup or opens a window when quit precedes app readiness", async () => {
  const { fixture, service, vault, exchange } = createCallbackReceptionFixture()
  const url = await prepareCallbackReceptionUrl(service)
  await import("./index")
  emitCallbackReceptionUrl(url)
  await disposeCallbackReceptionFixture()

  fixture.ready!.resolve(undefined)
  await vi.advanceTimersByTimeAsync(0)

  expect(fixture.setupEntered).toBe(0)
  expect(fixture.deviceReads).toBe(0)
  expect(fixture.windows).toHaveLength(0)
  expect(exchange).not.toHaveBeenCalled()
  expect(vault.values.size).toBe(0)
})

it("terminally closes reception with a fixed diagnostic when app readiness rejects", async () => {
  const { fixture, service, vault, exchange } = createCallbackReceptionFixture()
  const url = await prepareCallbackReceptionUrl(service)
  const raw = "fixture-callback-failure?code=synthetic-code&state=synthetic-state"
  fixture.readinessFailure = new Error(raw)
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined)
  try {
    await import("./index")
    emitCallbackReceptionUrl(url)
    fixture.ready!.resolve(undefined)
    await vi.advanceTimersByTimeAsync(0)

    expect(fixture.appEvents!.listenerCount("open-url")).toBe(0)
    expect(fixture.appEvents!.listenerCount("second-instance")).toBe(0)
    expect(fixture.setupEntered).toBe(0)
    expect(fixture.windows).toHaveLength(0)
    expect(exchange).not.toHaveBeenCalled()
    expect(vault.values.size).toBe(0)
    expect(log.mock.calls).toEqual([["AUTHORIZATION_STARTUP_FAILED"]])
    expect(JSON.stringify(log.mock.calls)).not.toContain(raw)
  } finally {
    log.mockRestore()
  }
})

it("expires buffered input after elapsed time even when the wall clock moves backward", async () => {
  const { fixture, service, vault, exchange } = createCallbackReceptionFixture()
  const url = await prepareCallbackReceptionUrl(service)
  await import("./index")
  emitCallbackReceptionUrl(url)

  vi.setSystemTime(new Date("2026-10-29T23:00:00Z"))
  await vi.advanceTimersByTimeAsync(60_001)
  await finishCallbackReceptionStartup()

  expect(fixture.windows).toHaveLength(1)
  expect(exchange.mock.calls.length).toBe(0)
  expect(vault.values.size).toBe(0)
  expect(service.getActiveSession()).not.toBeNull()
})

it("rejects a new callback beyond 32 waiting inputs and accepts it after the queue drains", async () => {
  const { service, vault, exchange } = createCallbackReceptionFixture()
  const valid = await prepareCallbackReceptionUrl(service)
  const sessionId = service.getActiveSession()?.sessionId
  await import("./index")
  for (let index = 0; index < 32; index++) {
    emitCallbackReceptionUrl(`pigclaude://authorize/callback?code=foreign-${index}&state=foreign`)
  }
  emitCallbackReceptionUrl(valid)
  await finishCallbackReceptionStartup()

  expect(exchange.mock.calls.length).toBe(0)
  expect(vault.values.size).toBe(0)
  expect(service.getActiveSession()?.sessionId).toBe(sessionId)

  emitCallbackReceptionUrl(valid)
  await vi.advanceTimersByTimeAsync(0)
  expect(exchange).toHaveBeenCalledOnce()
})

it("does not evict an earlier valid callback when a full waiting queue rejects new input", async () => {
  const { service, vault, exchange } = createCallbackReceptionFixture()
  const valid = await prepareCallbackReceptionUrl(service)
  await import("./index")
  emitCallbackReceptionUrl(valid)
  for (let index = 0; index < 32; index++) {
    emitCallbackReceptionUrl(`pigclaude://authorize/callback?code=foreign-${index}&state=foreign`)
  }
  await finishCallbackReceptionStartup()

  expect(exchange).toHaveBeenCalledOnce()
  expect(await vault.get("authorization:pigclaude-login:callback-fixture-user")).toContain(
    "callback-fixture-refresh",
  )
})

it("enforces the UTF-8 byte limit while accepting a valid callback at exactly 8192 bytes", async () => {
  const { service, vault, exchange } = createCallbackReceptionFixture()
  const original = await prepareCallbackReceptionUrl(service)
  const codeBytes = 8_192 - Buffer.byteLength(original.replace("callback-fixture-code", ""), "utf8")
  const code = "界".repeat(Math.floor(codeBytes / 3)) + "a".repeat(codeBytes % 3)
  const exact = original.replace("callback-fixture-code", code)
  expect(Buffer.byteLength(exact, "utf8")).toBe(8_192)
  expect(exact.length).toBeLessThan(8_192)
  await import("./index")
  await finishCallbackReceptionStartup()

  emitCallbackReceptionUrl(exact.replace("code=", "code=界"))
  await vi.advanceTimersByTimeAsync(0)
  expect(exchange.mock.calls.length).toBe(0)
  expect(vault.values.size).toBe(0)

  emitCallbackReceptionUrl(exact)
  await vi.advanceTimersByTimeAsync(0)
  expect(exchange).toHaveBeenCalledOnce()
  expect(vault.values.size).toBe(1)
})

it("releases expired waiting capacity before accepting a new valid input", async () => {
  const { service, exchange } = createCallbackReceptionFixture()
  const valid = await prepareCallbackReceptionUrl(service)
  await import("./index")
  for (let index = 0; index < 32; index++) {
    emitCallbackReceptionUrl(`pigclaude://authorize/callback?code=foreign-${index}&state=foreign`)
  }
  await vi.advanceTimersByTimeAsync(60_001)
  emitCallbackReceptionUrl(valid)
  await finishCallbackReceptionStartup()

  expect(exchange).toHaveBeenCalledOnce()
})

it("never installs reception or starts setup in an instance that did not acquire the lock", async () => {
  const { fixture, service, vault, exchange } = createCallbackReceptionFixture()
  fixture.hasLock = false
  const valid = await prepareCallbackReceptionUrl(service)
  await import("./index")
  emitCallbackReceptionUrl(valid)
  fixture.ready!.resolve(undefined)
  await vi.advanceTimersByTimeAsync(0)

  expect(fixture.appEvents!.listenerCount("open-url")).toBe(0)
  expect(fixture.appEvents!.listenerCount("second-instance")).toBe(0)
  expect(fixture.setupEntered).toBe(0)
  expect(fixture.windows).toHaveLength(0)
  expect(fixture.quitCalls).toBe(1)
  expect(exchange).not.toHaveBeenCalled()
  expect(vault.values.size).toBe(0)
})

it("keeps captured OS listeners inert after shutdown removes their subscriptions", async () => {
  const { fixture, service, vault, exchange } = createCallbackReceptionFixture()
  const valid = await prepareCallbackReceptionUrl(service)
  await import("./index")
  const open = fixture.appEvents!.listeners("open-url")[0]
  const second = fixture.appEvents!.listeners("second-instance")[0]
  if (!open || !second) throw new Error("fixture receiver listeners missing")
  await disposeCallbackReceptionFixture()

  Reflect.apply(open, undefined, [{ preventDefault: () => undefined }, valid])
  Reflect.apply(second, undefined, [{}, ["/fixture/app", valid]])
  fixture.ready!.resolve(undefined)
  await vi.advanceTimersByTimeAsync(0)

  expect(fixture.appEvents!.listenerCount("open-url")).toBe(0)
  expect(fixture.appEvents!.listenerCount("second-instance")).toBe(0)
  expect(fixture.focusCalls).toBe(0)
  expect(fixture.windows).toHaveLength(0)
  expect(exchange).not.toHaveBeenCalled()
  expect(vault.values.size).toBe(0)
})

it("does not deliver through a service assigned before a later setup failure", async () => {
  const { fixture, service, vault, exchange } = createCallbackReceptionFixture()
  const valid = await prepareCallbackReceptionUrl(service)
  fixture.screenFailure = true
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined)
  try {
    await import("./index")
    emitCallbackReceptionUrl(valid)
    await finishCallbackReceptionStartup()
    emitCallbackReceptionUrl(valid)
    await vi.advanceTimersByTimeAsync(0)

    expect(fixture.setupEntered).toBe(1)
    expect(fixture.appEvents!.listenerCount("open-url")).toBe(0)
    expect(fixture.appEvents!.listenerCount("second-instance")).toBe(0)
    expect(exchange).not.toHaveBeenCalled()
    expect(vault.values.size).toBe(0)
  } finally {
    log.mockRestore()
  }
})

it("does not start a new authorization after setup has terminally failed", async () => {
  const { fixture, service, exchange } = createCallbackReceptionFixture()
  fixture.screenFailure = true
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined)
  try {
    await import("./index")
    await finishCallbackReceptionStartup()

    expect(
      await invokeCallbackReceptionIpc("pigclaude:authorization-start", {
        purpose: "pigclaude-login",
        mode: "login",
      }),
    ).toMatchObject({ ok: false, status: "network-error" })
    expect(service.getActiveSession()).toBeNull()
    expect(exchange).not.toHaveBeenCalled()
  } finally {
    log.mockRestore()
  }
})

it("cleans late-created setup resources without reopening reception after quit", async () => {
  const { fixture, service, vault, exchange } = createCallbackReceptionFixture()
  const gate = deferred<void>()
  fixture.setupGate = gate
  const valid = await prepareCallbackReceptionUrl(service)
  await import("./index")
  emitCallbackReceptionUrl(valid)
  fixture.ready!.resolve(undefined)
  await vi.advanceTimersByTimeAsync(0)
  expect(fixture.callbackServerEntries).toBe(1)
  await disposeCallbackReceptionFixture()

  gate.resolve(undefined)
  await vi.advanceTimersByTimeAsync(0)

  expect(fixture.windows).toHaveLength(0)
  expect(fixture.appEvents!.listenerCount("open-url")).toBe(0)
  expect(fixture.appEvents!.listenerCount("second-instance")).toBe(0)
  expect(fixture.closeCalls).toBeGreaterThanOrEqual(fixture.callbackCreates)
  expect(fixture.compositionDisposals).toBeGreaterThanOrEqual(fixture.setupEntered)
  expect(exchange).not.toHaveBeenCalled()
  expect(vault.values.size).toBe(0)
})
