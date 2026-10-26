// 认证失败换号测试。消息请求在写出正文前收到 401/403 时标记账号失效并换下一个账号；
// 全部账号都失效时返回 auth_expired，正文已开始写出后不再换号。

import { describe, expect, it } from "vitest"
import { LocalDaemon } from "./daemon.ts"
import { startRecordingProxy, startScriptedProxy } from "./daemon-proxy-fixture.test.ts"

const sessionToken = "auth-failover-session-token"
const sessionHeaders = { "x-pigclaude-session": sessionToken }

describe("auth failover", () => {
  for (const status of [401, 403]) {
    it(`switches to the next account after a ${status} before any body is written`, async () => {
      const seen: Array<{ path: string; authorization: string | undefined }> = []
      const attempts: string[][] = []
      const selected: Array<[string, string | undefined]> = []
      const rejected: Array<[string, string]> = []
      const proxy = await startRecordingProxy(seen, () => {
        const authorization = seen.at(-1)?.authorization
        return authorization === "Bearer token-a"
          ? { status, headers: { "content-type": "application/json" }, body: '{"error":"auth"}' }
          : { status: 200, body: "ok" }
      })
      const daemon = new LocalDaemon({
        port: 0,
        sessionToken,
        runAuthorized: async (operation) => operation(new AbortController().signal),
        choose: ({ rejectedIds }) => {
          attempts.push([...rejectedIds])
          return rejectedIds.includes("a")
            ? { id: "b", authorization: "token-b", proxyUrl: proxy.url }
            : { id: "a", authorization: "token-a", proxyUrl: proxy.url }
        },
        onAccountRejected: (accountId, reason) => {
          rejected.push([accountId, reason])
        },
        onAccountSelected: (accountId, previousId) => {
          selected.push([accountId, previousId])
        },
      })
      await daemon.start()
      try {
        const response = await fetch(`http://127.0.0.1:${daemon.port}/v1/messages`, {
          method: "POST",
          headers: sessionHeaders,
          body: "{}",
        })
        expect(response.status).toBe(200)
        expect(await response.text()).toBe("ok")
        expect(attempts).toEqual([[], ["a"]])
        expect(selected).toEqual([
          ["a", undefined],
          ["b", "a"],
        ])
        expect(rejected).toEqual([["a", "auth"]])
      } finally {
        try {
          await daemon.stop()
        } finally {
          await proxy.stop()
        }
      }
    })
  }

  it("returns auth_expired when every account is rejected with 401", async () => {
    const attempts: string[][] = []
    const rejected: Array<[string, string]> = []
    const proxy = await startRecordingProxy([], () => ({ status: 401, body: "" }))
    const daemon = new LocalDaemon({
      port: 0,
      sessionToken,
      runAuthorized: async (operation) => operation(new AbortController().signal),
      choose: ({ rejectedIds }) => {
        attempts.push([...rejectedIds])
        if (!rejectedIds.includes("a")) {
          return { id: "a", authorization: "token-a", proxyUrl: proxy.url }
        }
        if (!rejectedIds.includes("b")) {
          return { id: "b", authorization: "token-b", proxyUrl: proxy.url }
        }
        return null
      },
      onAccountRejected: (accountId, reason) => {
        rejected.push([accountId, reason])
      },
    })
    await daemon.start()
    try {
      const response = await fetch(`http://127.0.0.1:${daemon.port}/v1/messages`, {
        method: "POST",
        headers: sessionHeaders,
        body: "{}",
      })
      expect(response.status).toBe(503)
      expect(await response.json()).toEqual({ error: "auth_expired" })
      expect(attempts).toEqual([[], ["a"], ["a", "b"]])
      expect(rejected).toEqual([
        ["a", "auth"],
        ["b", "auth"],
      ])
    } finally {
      try {
        await daemon.stop()
      } finally {
        await proxy.stop()
      }
    }
  })

  it("does not select another account once the response body has started", async () => {
    let calls = 0
    const selected: Array<[string, string | undefined]> = []
    const proxy = await startScriptedProxy(async () => {
      calls += 1
      return { status: 200, body: "hello", trickle: true }
    })
    const daemon = new LocalDaemon({
      port: 0,
      sessionToken,
      runAuthorized: async (operation) => operation(new AbortController().signal),
      choose: () => ({ id: "a", authorization: "token-a", proxyUrl: proxy.url }),
      onAccountSelected: (accountId, previousId) => {
        selected.push([accountId, previousId])
      },
    })
    await daemon.start()
    try {
      const response = await fetch(`http://127.0.0.1:${daemon.port}/v1/messages`, {
        method: "POST",
        headers: sessionHeaders,
        body: "{}",
      })
      const reader = response.body!.getReader()
      try {
        const first = await reader.read()
        expect(first.value?.byteLength).toBeGreaterThan(0)
        expect(calls).toBe(1)
        expect(selected).toEqual([["a", undefined]])
      } finally {
        await reader.cancel()
      }
    } finally {
      try {
        await daemon.stop()
      } finally {
        await proxy.stop()
      }
    }
  })

  it("returns proxy_unavailable when the chosen account has an empty proxy url", async () => {
    const daemon = new LocalDaemon({
      port: 0,
      sessionToken,
      runAuthorized: async (operation) => operation(new AbortController().signal),
      choose: () => ({ id: "a", authorization: "token-a", proxyUrl: "" }),
    })
    await daemon.start()
    try {
      const response = await fetch(`http://127.0.0.1:${daemon.port}/v1/messages`, {
        method: "POST",
        headers: sessionHeaders,
        body: "{}",
      })
      expect(response.status).toBe(503)
      expect(await response.json()).toEqual({ error: "proxy_unavailable" })
    } finally {
      await daemon.stop()
    }
  })

  it("forwards a 401 on non-message paths without selecting another account", async () => {
    let calls = 0
    const proxy = await startRecordingProxy([], () => {
      calls += 1
      return { status: 401, body: "unauthorized" }
    })
    const daemon = new LocalDaemon({
      port: 0,
      sessionToken,
      runAuthorized: async (operation) => operation(new AbortController().signal),
      choose: () => ({ id: "a", authorization: "token-a", proxyUrl: proxy.url }),
    })
    await daemon.start()
    try {
      const response = await fetch(`http://127.0.0.1:${daemon.port}/v1/models`, {
        headers: sessionHeaders,
      })
      expect(response.status).toBe(401)
      expect(await response.text()).toBe("unauthorized")
      expect(calls).toBe(1)
    } finally {
      try {
        await daemon.stop()
      } finally {
        await proxy.stop()
      }
    }
  })
})
