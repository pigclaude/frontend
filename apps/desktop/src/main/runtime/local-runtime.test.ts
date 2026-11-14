// 负责验证本机 runtime 的会员门禁、loopback 监听、退避重启、额度冷却和脱敏事件。

import { connect as netConnect } from "node:net"
import { networkInterfaces } from "node:os"
import { describe, expect, it, vi } from "vitest"
import type { LocalRuntimeEvent } from "./local-runtime"
import { account, harness, now, proxy } from "./local-runtime-fixtures"

describe("LocalRuntime", () => {
  it("starts the daemon only after membership becomes active", async () => {
    const h = await harness({ state: "connecting" })
    await h.runtime.start()
    expect(h.daemons).toHaveLength(0)
    expect((await h.runtime.inspect()).daemon).toBe("starting")

    h.membership.publish("active")
    h.membership.publish("active")
    await h.runtime.start()
    expect(h.daemons).toHaveLength(1)
    expect(h.daemons[0]?.started).toBe(true)
    expect((await h.runtime.inspect()).daemon).toBe("ready")
    await h.cleanup()
  })

  it("reports account count and a random session token", async () => {
    const h = await harness({ state: "connecting", accounts: [account("a"), account("b")] })
    expect(await h.runtime.inspect()).toMatchObject({ daemon: "starting", accountCount: 2 })
    const session = h.runtime.openSession({ sessionId: "s-1", preferredAccountId: null })
    expect(session.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    await h.cleanup()
  })

  it("reports whether an eligible account exists without selecting one", async () => {
    const h = await harness({ state: "connecting" })
    await expect(h.runtime.hasAvailableAccount()).resolves.toBe(false)

    await h.store.saveProxy(proxy("p1"))
    await h.store.saveAccount(account("a"))
    await expect(h.runtime.hasAvailableAccount()).resolves.toBe(true)

    await h.store.saveAccount(account("a", { enabled: false }))
    await expect(h.runtime.hasAvailableAccount()).resolves.toBe(false)
    await h.cleanup()
  })

  it("reports and selects a direct account without a proxy", async () => {
    const h = await harness({ state: "connecting", accounts: [account("a", { proxyId: null })] })
    await expect(h.runtime.hasAvailableAccount()).resolves.toBe(true)
    expect(await h.runtime.chooser.choose({ rejectedIds: [] })).toEqual({
      id: "a",
      authorization: "token-a",
      proxyUrl: null,
    })
    await h.cleanup()
  })

  it("binds only loopback and releases the port on stop", async () => {
    const h = await harness({ realDaemon: true })
    await h.runtime.start()
    const baseUrl = h.runtime.daemonBaseUrl
    expect(baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    const port = Number(new URL(baseUrl ?? "").port)

    const response = await fetch(`${baseUrl}/v1/models`)
    expect(response.status).toBe(403)
    expect((await response.json()) as unknown).toEqual({ error: "invalid_session_token" })
    expect(await canConnect("127.0.0.1", port)).toBe(true)
    const external = externalIpv4()
    if (external !== null) expect(await canConnect(external, port)).toBe(false)

    await h.runtime.stop()
    expect(h.runtime.daemonBaseUrl).toBeNull()
    expect((await h.runtime.inspect()).daemon).toBe("starting")
    expect(await canConnect("127.0.0.1", port)).toBe(false)
    await h.cleanup()
  })

  it("restarts with backoff after a failed start", async () => {
    const h = await harness({ startFailures: 2, backoffMs: [1_000, 2_000, 5_000, 10_000] })
    await h.runtime.start()
    expect(h.daemons).toHaveLength(3)
    expect(h.sleeps).toEqual([1_000, 2_000])
    expect(h.daemons[0]?.stopped).toBe(true)
    expect(h.daemons[2]?.started).toBe(true)
    expect((await h.runtime.inspect()).daemon).toBe("ready")
    await h.cleanup()
  })

  it("restarts with backoff after the daemon exits unexpectedly", async () => {
    const h = await harness({ backoffMs: [1_000] })
    await h.runtime.start()
    expect(h.daemons).toHaveLength(1)
    h.daemons[0]?.exit()
    await vi.waitFor(() => expect(h.daemons).toHaveLength(2))
    await h.runtime.start()
    expect(h.sleeps).toEqual([1_000])
    expect(h.daemons[1]?.started).toBe(true)
    expect((await h.runtime.inspect()).daemon).toBe("ready")
    await h.cleanup()
  })

  it("stays failed after the backoff sequence is exhausted", async () => {
    const h = await harness({ startFailures: 9, backoffMs: [10, 20] })
    await h.runtime.start()
    expect(h.sleeps).toEqual([10, 20])
    expect(h.daemons).toHaveLength(3)
    expect((await h.runtime.inspect()).daemon).toBe("failed")
    await h.cleanup()
  })

  it("stops the daemon and aborts in-flight requests when membership leaves active", async () => {
    const h = await harness()
    await h.runtime.start()
    const daemon = h.daemons[0]
    if (daemon === undefined) throw new Error("daemon not started")
    const settled = daemon.options
      .runAuthorized(
        (signal) =>
          new Promise<void>((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })
          }),
      )
      .then(
        () => "resolved",
        () => "rejected",
      )

    h.membership.publish("expired")
    expect(await settled).toBe("rejected")
    await vi.waitFor(() => expect(daemon.stopped).toBe(true))
    expect((await h.runtime.inspect()).daemon).toBe("starting")
    await h.cleanup()
  })

  it("cools a quota-exhausted account and keeps secrets out of events", async () => {
    const h = await harness({
      accounts: [account("a", { proxyId: "p-a" }), account("b", { proxyId: "p-b" })],
      proxies: [proxy("p-a"), proxy("p-b")],
      now: () => now,
      quotaCooldownMs: 300_000,
    })
    const events: LocalRuntimeEvent[] = []
    h.runtime.subscribe((event) => events.push(event))
    await h.runtime.start()
    const daemon = h.daemons[0]
    if (daemon === undefined) throw new Error("daemon not started")
    h.runtime.openSession({ sessionId: "s-1", preferredAccountId: null })

    daemon.options.onAccountSelected("s-1", "a", undefined)
    daemon.options.onAccountRejected("s-1", "a", "quota")
    daemon.options.onAccountSelected("s-1", "b", "a")
    await vi.waitFor(async () => {
      expect((await h.store.getAccount("a"))?.exhaustedUntil).toBe(
        new Date(now + 300_000).toISOString(),
      )
    })

    expect(events).toEqual([
      { type: "account-switched", sessionId: "s-1", from: null, to: "a", reason: "initial" },
      { type: "account-switched", sessionId: "s-1", from: "a", to: "b", reason: "quota" },
    ])
    const serialized = JSON.stringify(events)
    expect(serialized).not.toContain("token-a")
    expect(serialized).not.toContain("p-a.test")
    expect((await h.runtime.chooser.choose({ rejectedIds: [] }))?.id).toBe("b")
    await h.cleanup()
  })

  it("does not emit an event for repeated selections of the same account", async () => {
    const h = await harness()
    const events: LocalRuntimeEvent[] = []
    h.runtime.subscribe((event) => events.push(event))
    await h.runtime.start()
    const daemon = h.daemons[0]
    if (daemon === undefined) throw new Error("daemon not started")
    h.runtime.openSession({ sessionId: "s-1", preferredAccountId: null })

    daemon.options.onAccountSelected("s-1", "a", undefined)
    daemon.options.onAccountSelected("s-1", "a", undefined)
    expect(events).toEqual([
      { type: "account-switched", sessionId: "s-1", from: null, to: "a", reason: "initial" },
    ])
    await h.cleanup()
  })

  it("reports a cross-request switch from the previously selected account", async () => {
    const h = await harness()
    const events: LocalRuntimeEvent[] = []
    h.runtime.subscribe((event) => events.push(event))
    await h.runtime.start()
    const daemon = h.daemons[0]
    if (daemon === undefined) throw new Error("daemon not started")
    h.runtime.openSession({ sessionId: "s-1", preferredAccountId: null })

    daemon.options.onAccountSelected("s-1", "a", undefined)
    daemon.options.onAccountSelected("s-1", "b", undefined)
    expect(events).toEqual([
      { type: "account-switched", sessionId: "s-1", from: null, to: "a", reason: "initial" },
      { type: "account-switched", sessionId: "s-1", from: "a", to: "b", reason: "switch" },
    ])
    await h.cleanup()
  })

  it("broadcasts initial again for the same account after a session boundary", async () => {
    const h = await harness()
    const events: LocalRuntimeEvent[] = []
    h.runtime.subscribe((event) => events.push(event))
    await h.runtime.start()
    h.runtime.openSession({ sessionId: "s-1", preferredAccountId: null })
    h.daemons[0]?.options.onAccountSelected("s-1", "a", undefined)

    await h.runtime.stop()
    await h.runtime.start()
    h.runtime.openSession({ sessionId: "s-2", preferredAccountId: null })
    h.daemons[1]?.options.onAccountSelected("s-2", "a", undefined)

    expect(events).toEqual([
      { type: "account-switched", sessionId: "s-1", from: null, to: "a", reason: "initial" },
      { type: "account-switched", sessionId: "s-2", from: null, to: "a", reason: "initial" },
    ])
    await h.cleanup()
  })

  it("marks an auth-rejected account as needing reauthorization without reviving it", async () => {
    const h = await harness({
      accounts: [account("a", { proxyId: "p-a" }), account("b", { proxyId: "p-b" })],
      proxies: [proxy("p-a"), proxy("p-b")],
    })
    await h.runtime.start()
    const daemon = h.daemons[0]
    if (daemon === undefined) throw new Error("daemon not started")
    h.runtime.openSession({ sessionId: "s-1", preferredAccountId: null })

    daemon.options.onAccountRejected("s-1", "a", "auth")
    await vi.waitFor(async () => {
      expect((await h.store.getAccount("a"))?.needsReauth).toBe(true)
    })

    expect((await h.runtime.chooser.choose({ rejectedIds: [] }))?.id).toBe("b")
    await h.cleanup()
  })

  it("clears the quota marker when the marked account is selected again", async () => {
    const h = await harness()
    const events: LocalRuntimeEvent[] = []
    h.runtime.subscribe((event) => events.push(event))
    await h.runtime.start()
    const daemon = h.daemons[0]
    if (daemon === undefined) throw new Error("daemon not started")
    h.runtime.openSession({ sessionId: "s-1", preferredAccountId: null })

    daemon.options.onAccountSelected("s-1", "a", undefined)
    daemon.options.onAccountRejected("s-1", "a", "quota")
    daemon.options.onAccountSelected("s-1", "a", undefined)
    daemon.options.onAccountSelected("s-1", "b", undefined)
    expect(events).toEqual([
      { type: "account-switched", sessionId: "s-1", from: null, to: "a", reason: "initial" },
      { type: "account-switched", sessionId: "s-1", from: "a", to: "b", reason: "switch" },
    ])
    await h.cleanup()
  })
})

function externalIpv4(): string | null {
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) return entry.address
    }
  }
  return null
}

function canConnect(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = netConnect({ host, port })
    const timer = setTimeout(() => {
      socket.destroy()
      resolve(false)
    }, 500)
    socket.once("connect", () => {
      clearTimeout(timer)
      socket.destroy()
      resolve(true)
    })
    socket.once("error", () => {
      clearTimeout(timer)
      resolve(false)
    })
  })
}
