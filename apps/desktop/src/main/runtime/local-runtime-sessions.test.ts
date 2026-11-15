// 验证本机运行时按会话路由：每个会话自己的令牌、偏好账号、当前账号、额度拒绝和语言时区绑定互不影响，
// 换号事件带会话；账号冷却和「需要重新授权」仍写全局账号库；会话结束或会员失效后令牌不能再用。

import { createServer, type Server } from "node:http"
import { describe, expect, it, vi } from "vitest"
import type { LocalRuntimeEvent } from "./local-runtime"
import { account, harness, now, proxy } from "./local-runtime-fixtures"

const newYork = { lang: "en-US", timezone: "America/New_York" }
const tokyo = { lang: "ja-JP", timezone: "Asia/Tokyo" }

describe("LocalRuntime sessions", () => {
  it("swaps each concurrent session only to accounts of its own locale and timezone", async () => {
    const upstream = await quotaUpstream(["token-ny-1", "token-tokyo-1"])
    const h = await harness({
      accounts: [
        localAccount("ny-1", newYork),
        localAccount("tokyo-1", tokyo),
        localAccount("ny-2", newYork),
        localAccount("tokyo-2", tokyo),
      ],
      upstreamOrigin: new URL(upstream.origin),
      quotaCooldownMs: 300_000,
    })
    const events: LocalRuntimeEvent[] = []
    h.runtime.subscribe((event) => events.push(event))
    try {
      await h.runtime.start()
      const ny = h.runtime.openSession({ sessionId: "s-ny", preferredAccountId: null })
      const tk = h.runtime.openSession({ sessionId: "s-tokyo", preferredAccountId: null })
      await ny.bindEnvironment({ locale: "en-US", timezone: "America/New_York" })
      await tk.bindEnvironment({ locale: "ja-JP", timezone: "Asia/Tokyo" })

      const [nyResponse, tkResponse] = await Promise.all([
        post(h.runtime.daemonBaseUrl, ny.token),
        post(h.runtime.daemonBaseUrl, tk.token),
      ])

      expect([nyResponse.status, tkResponse.status]).toEqual([200, 200])
      expect(upstream.byToken.get(ny.token)).toEqual(["token-ny-1", "token-ny-2"])
      expect(upstream.byToken.get(tk.token)).toEqual(["token-tokyo-1", "token-tokyo-2"])
      expect(events.filter((event) => event.sessionId === "s-ny")).toEqual([
        { type: "account-switched", sessionId: "s-ny", from: null, to: "ny-1", reason: "initial" },
        { type: "account-switched", sessionId: "s-ny", from: "ny-1", to: "ny-2", reason: "quota" },
      ])
      expect(events.filter((event) => event.sessionId === "s-tokyo")).toEqual([
        {
          type: "account-switched",
          sessionId: "s-tokyo",
          from: null,
          to: "tokyo-1",
          reason: "initial",
        },
        {
          type: "account-switched",
          sessionId: "s-tokyo",
          from: "tokyo-1",
          to: "tokyo-2",
          reason: "quota",
        },
      ])
      await vi.waitFor(async () => {
        expect((await h.store.getAccount("ny-1"))?.exhaustedUntil).toBe(
          new Date(now + 300_000).toISOString(),
        )
        expect((await h.store.getAccount("tokyo-1"))?.exhaustedUntil).toBe(
          new Date(now + 300_000).toISOString(),
        )
      })
    } finally {
      await h.cleanup()
      await upstream.close()
    }
  })

  it("keeps the current account and quota rejections of each session apart", async () => {
    const h = await harness()
    const events: LocalRuntimeEvent[] = []
    h.runtime.subscribe((event) => events.push(event))
    await h.runtime.start()
    const daemon = h.daemons[0]
    if (daemon === undefined) throw new Error("daemon not started")
    h.runtime.openSession({ sessionId: "s-1", preferredAccountId: null })
    h.runtime.openSession({ sessionId: "s-2", preferredAccountId: null })

    daemon.options.onAccountSelected("s-1", "a", undefined)
    daemon.options.onAccountRejected("s-1", "a", "quota")
    daemon.options.onAccountSelected("s-2", "a", undefined)
    daemon.options.onAccountSelected("s-1", "b", "a")
    daemon.options.onAccountSelected("s-2", "b", undefined)

    expect(events).toEqual([
      { type: "account-switched", sessionId: "s-1", from: null, to: "a", reason: "initial" },
      { type: "account-switched", sessionId: "s-2", from: null, to: "a", reason: "initial" },
      { type: "account-switched", sessionId: "s-1", from: "a", to: "b", reason: "quota" },
      { type: "account-switched", sessionId: "s-2", from: "a", to: "b", reason: "switch" },
    ])
    await h.cleanup()
  })

  it("chooses each session's own preferred account", async () => {
    const h = await harness({ accounts: [account("a"), account("b")], proxies: [proxy("p1")] })
    await h.runtime.start()
    const daemon = h.daemons[0]
    if (daemon === undefined) throw new Error("daemon not started")
    h.runtime.openSession({ sessionId: "prefers-b", preferredAccountId: "b" })
    h.runtime.openSession({ sessionId: "automatic", preferredAccountId: null })

    expect((await daemon.options.choose({ sessionId: "prefers-b", rejectedIds: [] }))?.id).toBe("b")
    expect((await daemon.options.choose({ sessionId: "automatic", rejectedIds: [] }))?.id).toBe("a")
    await h.cleanup()
  })

  it("writes cooldown and reauthorization to the shared account records", async () => {
    const h = await harness({
      accounts: [account("a"), account("b"), account("c")],
      proxies: [proxy("p1")],
      quotaCooldownMs: 300_000,
    })
    await h.runtime.start()
    const daemon = h.daemons[0]
    if (daemon === undefined) throw new Error("daemon not started")
    h.runtime.openSession({ sessionId: "s-1", preferredAccountId: null })
    h.runtime.openSession({ sessionId: "s-2", preferredAccountId: null })

    daemon.options.onAccountRejected("s-1", "a", "quota")
    daemon.options.onAccountRejected("s-1", "b", "auth")
    await vi.waitFor(async () => {
      expect((await h.store.getAccount("a"))?.exhaustedUntil).toBe(
        new Date(now + 300_000).toISOString(),
      )
      expect((await h.store.getAccount("b"))?.needsReauth).toBe(true)
    })

    expect((await daemon.options.choose({ sessionId: "s-2", rejectedIds: [] }))?.id).toBe("c")
    await h.cleanup()
  })

  it("revokes a closed session's token and stops tracking it", async () => {
    const upstream = await quotaUpstream([])
    const h = await harness({
      accounts: [localAccount("a", newYork)],
      upstreamOrigin: new URL(upstream.origin),
    })
    const events: LocalRuntimeEvent[] = []
    h.runtime.subscribe((event) => events.push(event))
    try {
      await h.runtime.start()
      const closed = h.runtime.openSession({ sessionId: "closed", preferredAccountId: null })
      const open = h.runtime.openSession({ sessionId: "open", preferredAccountId: null })
      closed.close()
      closed.close()

      const rejected = await post(h.runtime.daemonBaseUrl, closed.token)
      expect(rejected.status).toBe(403)
      expect(await rejected.json()).toEqual({ error: "invalid_session_token" })
      expect((await post(h.runtime.daemonBaseUrl, open.token)).status).toBe(200)
      expect(upstream.byToken.has(closed.token)).toBe(false)
      expect(events.map((event) => event.sessionId)).toEqual(["open"])
    } finally {
      await h.cleanup()
      await upstream.close()
    }
  })

  it("revokes every token when membership leaves active", async () => {
    const upstream = await quotaUpstream([])
    const h = await harness({
      accounts: [localAccount("a", newYork)],
      upstreamOrigin: new URL(upstream.origin),
    })
    try {
      await h.runtime.start()
      const session = h.runtime.openSession({ sessionId: "s-1", preferredAccountId: null })
      h.membership.publish("expired")
      await vi.waitFor(() => expect(h.runtime.daemonBaseUrl).toBeNull())
      h.membership.publish("active")
      await h.runtime.start()

      const response = await post(h.runtime.daemonBaseUrl, session.token)
      expect(response.status).toBe(403)
      expect(upstream.byToken.size).toBe(0)
    } finally {
      await h.cleanup()
      await upstream.close()
    }
  })

  it("lets a session bind its own environment while another session is bound", async () => {
    const h = await harness({
      accounts: [localAccount("ny-1", newYork), localAccount("tokyo-1", tokyo)],
    })
    const first = h.runtime.openSession({ sessionId: "s-1", preferredAccountId: null })
    const second = h.runtime.openSession({ sessionId: "s-2", preferredAccountId: null })
    await first.bindEnvironment({ locale: "en-US", timezone: "America/New_York" })
    await expect(
      second.bindEnvironment({ locale: "ja-JP", timezone: "Asia/Tokyo" }),
    ).resolves.toMatchObject({ release: expect.any(Function) })
    await expect(
      first.bindEnvironment({ locale: "en-US", timezone: "America/New_York" }),
    ).rejects.toThrow(/SESSION_ALREADY_ACTIVE/)
    await h.cleanup()
  })
})

function localAccount(id: string, environment: { lang: string; timezone: string }) {
  const base = account(id, { proxyId: null })
  return { ...base, fingerprint: { ...base.fingerprint, ...environment } }
}

function post(baseUrl: string | null, token: string): Promise<Response> {
  return fetch(`${baseUrl ?? ""}/v1/messages`, {
    method: "POST",
    headers: {
      "x-pigclaude-session": token,
      "x-test-session": token,
      "content-type": "application/json",
    },
    body: "{}",
  })
}

type QuotaUpstream = {
  origin: string
  /** 每个会话令牌对应的上游请求里依次出现的账号凭据。 */
  byToken: Map<string, string[]>
  close: () => Promise<void>
}

// 本机假上游：列出的凭据回额度用尽，其余回 200。daemon 转发时去掉会话头，所以按客户端带来的 x-test-session 归类。
async function quotaUpstream(exhausted: string[]): Promise<QuotaUpstream> {
  const byToken = new Map<string, string[]>()
  const server: Server = createServer((request, response) => {
    request.resume()
    const credential = (request.headers.authorization ?? "").replace(/^Bearer /, "")
    const session = String(request.headers["x-test-session"] ?? "")
    byToken.set(session, [...(byToken.get(session) ?? []), credential])
    if (exhausted.includes(credential)) {
      response.writeHead(429, { "x-quota-exhausted": "1" })
      response.end()
      return
    }
    response.writeHead(200, { "content-type": "application/json" })
    response.end("{}")
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("假上游没有监听")
  return {
    origin: `http://127.0.0.1:${address.port}`,
    byToken,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}
