// daemon 按会话令牌路由的测试。注册的令牌把请求归到它的会话，选号和换号回调都带上这个会话；
// 未知或已吊销的令牌在会员核验和选号之前返回 403，不消耗凭据。

import { describe, expect, it, vi } from "vitest"
import { DaemonSessions, LocalDaemon } from "./daemon.ts"
import { startRecordingProxy } from "./daemon-proxy-fixture.test.ts"

describe("daemon session registry", () => {
  it("routes each registered token to its own session in every callback", async () => {
    let calls = 0
    const proxy = await startRecordingProxy([], async () => {
      calls += 1
      return calls === 1
        ? { status: 429, headers: { "x-quota-exhausted": "1" }, body: "" }
        : { status: 200, body: "ok" }
    })
    const sessions = new DaemonSessions()
    const first = sessions.register("session-a")
    const second = sessions.register("session-b")
    const chosen: Array<[string, string[]]> = []
    const selected: Array<[string, string]> = []
    const rejected: Array<[string, string]> = []
    const daemon = new LocalDaemon({
      port: 0,
      sessions,
      runAuthorized: async (operation) => operation(new AbortController().signal),
      choose: ({ sessionId, rejectedIds }) => {
        chosen.push([sessionId, rejectedIds])
        const id = rejectedIds.includes("a") ? "b" : "a"
        return { id, authorization: `token-${id}`, proxyUrl: proxy.url }
      },
      onAccountSelected: (sessionId, accountId) => {
        selected.push([sessionId, accountId])
      },
      onAccountRejected: (sessionId, accountId) => {
        rejected.push([sessionId, accountId])
      },
    })
    await daemon.start()
    try {
      const firstResponse = await post(daemon, first)
      const secondResponse = await post(daemon, second)
      expect([firstResponse.status, secondResponse.status]).toEqual([200, 200])
      expect(chosen).toEqual([
        ["session-a", []],
        ["session-a", ["a"]],
        ["session-b", []],
      ])
      expect(selected).toEqual([
        ["session-a", "a"],
        ["session-a", "b"],
        ["session-b", "a"],
      ])
      expect(rejected).toEqual([["session-a", "a"]])
    } finally {
      try {
        await daemon.stop()
      } finally {
        await proxy.stop()
      }
    }
  })

  it("rejects a revoked token without checking membership or choosing an account", async () => {
    const sessions = new DaemonSessions()
    const revoked = sessions.register("session-a")
    const kept = sessions.register("session-b")
    sessions.revoke(revoked)
    const choose = vi.fn(() => null)
    const runAuthorized = vi.fn(async <T>(operation: (signal: AbortSignal) => Promise<T>) =>
      operation(new AbortController().signal),
    )
    const daemon = new LocalDaemon({ port: 0, sessions, choose, runAuthorized })
    await daemon.start()
    try {
      const response = await post(daemon, revoked)
      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({ error: "invalid_session_token" })
      expect(choose).not.toHaveBeenCalled()
      expect(runAuthorized).not.toHaveBeenCalled()
      expect(sessions.resolve(kept)).toBe("session-b")
    } finally {
      await daemon.stop()
    }
  })

  it("rejects an unknown token and every token after revokeAll", async () => {
    const sessions = new DaemonSessions()
    const token = sessions.register("session-a")
    const choose = vi.fn(() => null)
    const runAuthorized = vi.fn(async <T>(operation: (signal: AbortSignal) => Promise<T>) =>
      operation(new AbortController().signal),
    )
    const daemon = new LocalDaemon({ port: 0, sessions, choose, runAuthorized })
    await daemon.start()
    try {
      const unknown = await post(daemon, "not-a-registered-token")
      expect(unknown.status).toBe(403)
      expect(await unknown.json()).toEqual({ error: "invalid_session_token" })
      sessions.revokeAll()
      const cleared = await post(daemon, token)
      expect(cleared.status).toBe(403)
      expect(await cleared.json()).toEqual({ error: "invalid_session_token" })
      expect(choose).not.toHaveBeenCalled()
      expect(runAuthorized).not.toHaveBeenCalled()
    } finally {
      await daemon.stop()
    }
  })

  it("stops switching accounts once the session is revoked mid-request", async () => {
    const proxy = await startRecordingProxy([], async () => ({
      status: 429,
      headers: { "x-quota-exhausted": "1" },
      body: "",
    }))
    const sessions = new DaemonSessions()
    const token = sessions.register("session-a")
    const choose = vi.fn(() => ({ id: "a", authorization: "token-a", proxyUrl: proxy.url }))
    const daemon = new LocalDaemon({
      port: 0,
      sessions,
      choose,
      runAuthorized: async (operation) => operation(new AbortController().signal),
      onAccountRejected: () => sessions.revoke(token),
    })
    await daemon.start()
    try {
      const response = await post(daemon, token)
      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({ error: "invalid_session_token" })
      expect(choose).toHaveBeenCalledTimes(1)
    } finally {
      try {
        await daemon.stop()
      } finally {
        await proxy.stop()
      }
    }
  })

  it("does not forward when the session is revoked while an account is being chosen", async () => {
    const seen: Array<{ path: string; authorization: string | undefined }> = []
    const proxy = await startRecordingProxy(seen)
    const sessions = new DaemonSessions()
    const token = sessions.register("session-a")
    let entered: () => void = () => undefined
    const choosing = new Promise<void>((resolve) => {
      entered = resolve
    })
    let release: () => void = () => undefined
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    const daemon = new LocalDaemon({
      port: 0,
      sessions,
      runAuthorized: async (operation) => operation(new AbortController().signal),
      choose: async () => {
        entered()
        await released
        return { id: "a", authorization: "token-a", proxyUrl: proxy.url }
      },
    })
    await daemon.start()
    try {
      const pending = post(daemon, token)
      await choosing
      sessions.revoke(token)
      release()
      const response = await pending
      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({ error: "invalid_session_token" })
      expect(seen).toEqual([])
    } finally {
      try {
        await daemon.stop()
      } finally {
        await proxy.stop()
      }
    }
  })

  it("issues distinct url-safe random tokens", () => {
    const sessions = new DaemonSessions()
    const first = sessions.register("session-a")
    const second = sessions.register("session-a")
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(second).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(first).not.toBe(second)
  })
})

function post(daemon: LocalDaemon, token: string): Promise<Response> {
  return fetch(`http://127.0.0.1:${daemon.port}/v1/messages`, {
    method: "POST",
    headers: { "x-pigclaude-session": token },
    body: "{}",
  })
}
