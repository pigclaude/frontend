// 负责贯通真实主进程系统事件、授权服务、秘密提交与 renderer 状态输出。
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
} from "./testing/callback-reception-fixture"
import { deferred, oauthSessionFixture } from "./testing/profile-fixture"
import type { AuthorizationToken } from "./authorization/types"

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

it("exchanges and commits once when both OS events carry the same real IPC authorization", async () => {
  const { fixture, service, vault, exchange } = createCallbackReceptionFixture()
  const writes = vi.spyOn(vault, "set")
  await import("./index")
  await finishCallbackReceptionStartup()
  expect(
    await invokeCallbackReceptionIpc("pigclaude:authorization-start", {
      purpose: "pigclaude-login",
      mode: "login",
    }),
  ).toMatchObject({ ok: true })
  const session = service.getActiveSession()
  if (!session) throw new Error("fixture IPC authorization missing")
  const callback = activeCallbackReceptionUrl(service)

  emitCallbackReceptionUrl(callback)
  emitCallbackReceptionArguments(["/fixture/app path", callback, "--unrelated-argument"])
  await vi.advanceTimersByTimeAsync(0)

  expect(exchange).toHaveBeenCalledOnce()
  expect(writes).toHaveBeenCalledOnce()
  expect(
    fixture.sent.filter(
      ({ value }) =>
        typeof value === "object" &&
        value !== null &&
        "status" in value &&
        value.status === "completed",
    ),
  ).toEqual([
    {
      channel: "pigclaude:authorization-state",
      value: expect.objectContaining({ sessionId: session.sessionId, status: "completed" }),
    },
  ])
  expect(fixture.sent).toContainEqual({
    channel: "pigclaude:authorization-state",
    value: expect.objectContaining({
      status: "browser-open",
      authorizationUrl: expect.stringContaining(session.state),
    }),
  })
  expect(JSON.stringify(fixture.sent)).not.toContain("callback-fixture-code")
  expect(JSON.stringify(fixture.sent)).not.toContain(session.codeVerifier)
})

it("never lends a newer UI session to foreign callbacks and still accepts its valid callback", async () => {
  const { fixture, service, vault, exchange } = createCallbackReceptionFixture()
  const writes = vi.spyOn(vault, "set")
  await import("./index")
  await finishCallbackReceptionStartup()
  await invokeCallbackReceptionIpc("pigclaude:authorization-start", {
    purpose: "pigclaude-login",
    mode: "login",
  })
  const oldUrl = activeCallbackReceptionUrl(service)
  const oldId = service.getActiveSession()?.sessionId
  await invokeCallbackReceptionIpc("pigclaude:authorization-cancel", oldId)
  await invokeCallbackReceptionIpc("pigclaude:authorization-start", {
    purpose: "pigclaude-login",
    mode: "login",
  })
  const session = service.getActiveSession()
  if (!session) throw new Error("fixture fresh authorization missing")
  const freshUrl = activeCallbackReceptionUrl(service)
  fixture.sent.length = 0

  for (const url of [
    oldUrl,
    `${freshUrl}&state=${session.state}`,
    `${freshUrl}&unknown=argument`,
    `${freshUrl}#fragment`,
    freshUrl.replace("authorize/callback", "authorize/callback/extra"),
    "https://auth.fixture.invalid/authorize/callback?code=foreign",
    "file:///authorize/callback?code=foreign",
  ]) {
    emitCallbackReceptionUrl(url)
    await vi.advanceTimersByTimeAsync(0)
    expect(service.getActiveSession()?.sessionId).toBe(session.sessionId)
    expect(fixture.sent).toEqual([])
  }
  expect(exchange).not.toHaveBeenCalled()
  expect(writes).not.toHaveBeenCalled()

  emitCallbackReceptionArguments(["/fixture/app", "--existing", freshUrl, "tail"])
  await vi.advanceTimersByTimeAsync(0)
  expect(exchange).toHaveBeenCalledOnce()
  expect(writes).toHaveBeenCalledOnce()
  expect(fixture.sent).toContainEqual({
    channel: "pigclaude:authorization-state",
    value: expect.objectContaining({ sessionId: session.sessionId, status: "completed" }),
  })
  const committed = await vault.get("authorization:pigclaude-login:callback-fixture-user")
  emitCallbackReceptionUrl(oldUrl)
  await vi.advanceTimersByTimeAsync(0)
  expect(exchange).toHaveBeenCalledOnce()
  expect(await vault.get("authorization:pigclaude-login:callback-fixture-user")).toBe(committed)
})

it("selects only the first candidate argument instead of searching for a later matching transaction", async () => {
  const { service, vault, exchange } = createCallbackReceptionFixture()
  await import("./index")
  await finishCallbackReceptionStartup()
  await invokeCallbackReceptionIpc("pigclaude:authorization-start", {
    purpose: "pigclaude-login",
    mode: "login",
  })
  const valid = activeCallbackReceptionUrl(service)
  const sessionId = service.getActiveSession()?.sessionId

  emitCallbackReceptionArguments([
    "/fixture/app path",
    "pigclaude://authorize/callback?code=foreign&state=foreign",
    valid,
  ])
  await vi.advanceTimersByTimeAsync(0)
  expect(exchange).not.toHaveBeenCalled()
  expect(vault.values.size).toBe(0)
  expect(service.getActiveSession()?.sessionId).toBe(sessionId)

  emitCallbackReceptionArguments(["/fixture/app path", "https://unrelated.invalid", valid, "tail"])
  await vi.advanceTimersByTimeAsync(0)
  expect(exchange).toHaveBeenCalledOnce()
})

it("preserves an in-flight result during shutdown without waking the window again", async () => {
  const { fixture, service, vault, exchange } = createCallbackReceptionFixture()
  fixture.runtimeEnabled = true
  const entered = deferred<void>()
  const response = deferred<AuthorizationToken>()
  exchange.mockImplementation(async () => {
    entered.resolve(undefined)
    return response.promise
  })
  await import("./index")
  await finishCallbackReceptionStartup()
  await invokeCallbackReceptionIpc("pigclaude:authorization-start", {
    purpose: "pigclaude-login",
    mode: "login",
  })
  emitCallbackReceptionUrl(activeCallbackReceptionUrl(service))
  await entered.promise
  const focused = fixture.focusCalls
  fixture.sent.length = 0
  fixture.appEvents!.emit("before-quit", { preventDefault: () => undefined })
  response.resolve(callbackReceptionToken())
  await vi.advanceTimersByTimeAsync(0)

  expect(await vault.get("authorization:pigclaude-login:callback-fixture-user")).toContain(
    "callback-fixture-refresh",
  )
  expect(fixture.focusCalls).toBe(focused)
  expect(fixture.sent).toEqual([])
})

it("does not let ordinary cancellation interrupt a callback already committing", async () => {
  const { fixture, service, vault, exchange } = createCallbackReceptionFixture()
  const entered = deferred<void>()
  const write = deferred<void>()
  fixture.beforeCommit = async () => {
    entered.resolve(undefined)
    await write.promise
  }
  exchange.mockResolvedValue({ ...callbackReceptionToken(), oauthSession: oauthSessionFixture() })
  try {
    await import("./index")
    await finishCallbackReceptionStartup()
    await invokeCallbackReceptionIpc("pigclaude:authorization-start", {
      purpose: "pigclaude-login",
      mode: "login",
    })
    const id = service.getActiveSession()?.sessionId
    const url = activeCallbackReceptionUrl(service)
    emitCallbackReceptionUrl(url)
    await entered.promise

    expect(await invokeCallbackReceptionIpc("pigclaude:authorization-cancel", id)).toMatchObject({
      sessionId: id,
      status: "committing",
    })
    emitCallbackReceptionArguments(["/fixture/app", url])
    expect(vault.values.size).toBe(0)
    write.resolve(undefined)
    await vi.advanceTimersByTimeAsync(0)

    expect(exchange).toHaveBeenCalledOnce()
    expect(fixture.commits).toBe(1)
    expect(await vault.get("membership:session")).toContain("new-fixture-refresh")
    expect(fixture.sent).toContainEqual({
      channel: "pigclaude:authorization-state",
      value: expect.objectContaining({ sessionId: id, status: "completed" }),
    })
  } finally {
    write.resolve(undefined)
  }
})

it("closes reception during an atomic commit without cancelling that entered write", async () => {
  const { fixture, service, vault, exchange } = createCallbackReceptionFixture()
  fixture.runtimeEnabled = true
  const entered = deferred<void>()
  const write = deferred<void>()
  fixture.beforeCommit = async () => {
    entered.resolve(undefined)
    await write.promise
  }
  exchange.mockResolvedValue({ ...callbackReceptionToken(), oauthSession: oauthSessionFixture() })
  try {
    await import("./index")
    await finishCallbackReceptionStartup()
    await invokeCallbackReceptionIpc("pigclaude:authorization-start", {
      purpose: "pigclaude-login",
      mode: "login",
    })
    const url = activeCallbackReceptionUrl(service)
    emitCallbackReceptionUrl(url)
    await entered.promise
    emitCallbackReceptionArguments(["/fixture/app", url])
    fixture.sent.length = 0
    const focused = fixture.focusCalls
    fixture.appEvents!.emit("before-quit", { preventDefault: () => undefined })
    write.resolve(undefined)
    await vi.advanceTimersByTimeAsync(0)

    expect(exchange).toHaveBeenCalledOnce()
    expect(fixture.commits).toBe(1)
    expect(await vault.get("membership:session")).toContain("new-fixture-refresh")
    expect(fixture.focusCalls).toBe(focused)
    expect(fixture.sent).toEqual([])
  } finally {
    write.resolve(undefined)
  }
})

it("clears queued input on sign-out so a new authorization is not displaced behind the old exchange", async () => {
  const { fixture, service, vault, exchange } = createCallbackReceptionFixture()
  const entered = deferred<void>()
  const oldResponse = deferred<AuthorizationToken>()
  let calls = 0
  exchange.mockImplementation(async () => {
    if (++calls === 1) {
      entered.resolve(undefined)
      return oldResponse.promise
    }
    return callbackReceptionToken()
  })
  try {
    await import("./index")
    await finishCallbackReceptionStartup()
    await invokeCallbackReceptionIpc("pigclaude:authorization-start", {
      purpose: "pigclaude-login",
      mode: "login",
    })
    emitCallbackReceptionUrl(activeCallbackReceptionUrl(service))
    await entered.promise
    for (let index = 0; index < 32; index++) {
      emitCallbackReceptionUrl(`pigclaude://authorize/callback?code=old-${index}&state=foreign`)
    }
    expect(await invokeCallbackReceptionIpc("pigclaude:membership-sign-out")).toMatchObject({
      state: "signed_out",
    })
    await invokeCallbackReceptionIpc("pigclaude:authorization-start", {
      purpose: "pigclaude-login",
      mode: "login",
    })
    const fresh = service.getActiveSession()?.sessionId
    emitCallbackReceptionUrl(activeCallbackReceptionUrl(service))
    fixture.sent.length = 0
    oldResponse.resolve(callbackReceptionToken())
    await vi.advanceTimersByTimeAsync(0)

    expect(exchange).toHaveBeenCalledTimes(2)
    expect(await vault.get("authorization:pigclaude-login:callback-fixture-user")).toContain(
      "callback-fixture-refresh",
    )
    expect(fixture.sent).toContainEqual({
      channel: "pigclaude:authorization-state",
      value: expect.objectContaining({ sessionId: fresh, status: "completed" }),
    })
  } finally {
    oldResponse.resolve(callbackReceptionToken())
  }
})

it("expires waiting inputs while an earlier callback is still exchanging", async () => {
  const { fixture, service, exchange } = createCallbackReceptionFixture()
  const entered = deferred<void>()
  const oldResponse = deferred<AuthorizationToken>()
  let calls = 0
  exchange.mockImplementation(async () => {
    if (++calls === 1) {
      entered.resolve(undefined)
      return oldResponse.promise
    }
    return callbackReceptionToken()
  })
  try {
    await import("./index")
    await finishCallbackReceptionStartup()
    await invokeCallbackReceptionIpc("pigclaude:authorization-start", {
      purpose: "pigclaude-login",
      mode: "login",
    })
    emitCallbackReceptionUrl(activeCallbackReceptionUrl(service))
    await entered.promise
    for (let index = 0; index < 32; index++) {
      emitCallbackReceptionUrl(`pigclaude://authorize/callback?code=old-${index}&state=foreign`)
    }
    await vi.advanceTimersByTimeAsync(60_001)
    await invokeCallbackReceptionIpc("pigclaude:authorization-start", {
      purpose: "pigclaude-login",
      mode: "login",
    })
    const fresh = service.getActiveSession()?.sessionId
    emitCallbackReceptionUrl(activeCallbackReceptionUrl(service))
    fixture.sent.length = 0
    oldResponse.resolve(callbackReceptionToken())
    await vi.advanceTimersByTimeAsync(0)

    expect(exchange).toHaveBeenCalledTimes(2)
    expect(fixture.sent).toContainEqual({
      channel: "pigclaude:authorization-state",
      value: expect.objectContaining({ sessionId: fresh, status: "completed" }),
    })
  } finally {
    oldResponse.resolve(callbackReceptionToken())
  }
})

it("reports a fixed dispatch diagnostic and continues reception after a service port throws", async () => {
  const { fixture, service, vault, exchange } = createCallbackReceptionFixture()
  const raw = "fixture-dispatch?code=synthetic-code&state=synthetic-state"
  fixture.abandoned = async () => {
    throw new Error(raw)
  }
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined)
  try {
    await import("./index")
    await finishCallbackReceptionStartup()
    await invokeCallbackReceptionIpc("pigclaude:authorization-start", {
      purpose: "pigclaude-login",
      mode: "login",
    })
    const state = service.getActiveSession()?.state
    emitCallbackReceptionUrl(`pigclaude://authorize/callback?error=access_denied&state=${state}`)
    await vi.advanceTimersByTimeAsync(0)
    expect(log.mock.calls).toEqual([["AUTHORIZATION_CALLBACK_DELIVERY_FAILED"]])
    expect(JSON.stringify(log.mock.calls)).not.toContain(raw)
    expect(exchange).not.toHaveBeenCalled()
    expect(vault.values.size).toBe(0)

    fixture.abandoned = null
    await invokeCallbackReceptionIpc("pigclaude:authorization-start", {
      purpose: "pigclaude-login",
      mode: "login",
    })
    const fresh = service.getActiveSession()?.sessionId
    emitCallbackReceptionUrl(activeCallbackReceptionUrl(service))
    await vi.advanceTimersByTimeAsync(0)
    expect(exchange).toHaveBeenCalledOnce()
    expect(fixture.sent).toContainEqual({
      channel: "pigclaude:authorization-state",
      value: expect.objectContaining({ sessionId: fresh, status: "completed" }),
    })
  } finally {
    log.mockRestore()
  }
})

it("allows 32 waiting inputs in addition to one callback already being delivered", async () => {
  const { fixture, service, vault, exchange } = createCallbackReceptionFixture()
  const entered = deferred<void>()
  const oldResponse = deferred<AuthorizationToken>()
  let calls = 0
  exchange.mockImplementation(async () => {
    if (++calls === 1) {
      entered.resolve(undefined)
      return oldResponse.promise
    }
    return callbackReceptionToken()
  })
  try {
    await import("./index")
    await finishCallbackReceptionStartup()
    await invokeCallbackReceptionIpc("pigclaude:authorization-start", {
      purpose: "pigclaude-login",
      mode: "login",
    })
    emitCallbackReceptionUrl(activeCallbackReceptionUrl(service))
    await entered.promise
    await invokeCallbackReceptionIpc("pigclaude:authorization-start", {
      purpose: "pigclaude-login",
      mode: "login",
    })
    const fresh = service.getActiveSession()?.sessionId
    for (let index = 0; index < 31; index++) {
      emitCallbackReceptionUrl(`pigclaude://authorize/callback?code=foreign-${index}&state=foreign`)
    }
    emitCallbackReceptionUrl(activeCallbackReceptionUrl(service))
    fixture.sent.length = 0
    oldResponse.resolve(callbackReceptionToken())
    await vi.advanceTimersByTimeAsync(0)

    expect(exchange).toHaveBeenCalledTimes(2)
    expect(vault.values.size).toBe(1)
    expect(fixture.sent).toContainEqual({
      channel: "pigclaude:authorization-state",
      value: expect.objectContaining({ sessionId: fresh, status: "completed" }),
    })
  } finally {
    oldResponse.resolve(callbackReceptionToken())
  }
})
