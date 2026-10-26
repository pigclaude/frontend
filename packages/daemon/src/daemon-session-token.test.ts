// 本机 daemon 的会话令牌测试。缺少或不匹配的 x-pigclaude-session 在选号前返回 403；
// 匹配时正常转发，并且不把该头交给上游。

import { describe, expect, it, vi } from "vitest"
import { LocalDaemon } from "./daemon.ts"
import { startRecordingProxy } from "./daemon-proxy-fixture.test.ts"

const sessionToken = "local-session-token"

describe("daemon session token", () => {
  it("rejects a request without the session header before choosing an account", async () => {
    const choose = vi.fn(() => null)
    const daemon = new LocalDaemon({
      port: 0,
      sessionToken,
      choose,
      runAuthorized: async (operation) => operation(new AbortController().signal),
    })
    await daemon.start()
    try {
      const response = await fetch(`http://127.0.0.1:${daemon.port}/v1/models`)
      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({ error: "invalid_session_token" })
      expect(choose).not.toHaveBeenCalled()
    } finally {
      await daemon.stop()
    }
  })

  it("rejects a message request with a different session token without reading the account", async () => {
    const choose = vi.fn(() => null)
    const daemon = new LocalDaemon({
      port: 0,
      sessionToken,
      choose,
      runAuthorized: async (operation) => operation(new AbortController().signal),
    })
    await daemon.start()
    try {
      const response = await fetch(`http://127.0.0.1:${daemon.port}/v1/messages`, {
        method: "POST",
        headers: { "x-pigclaude-session": "another-session" },
        body: "{}",
      })
      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({ error: "invalid_session_token" })
      expect(choose).not.toHaveBeenCalled()
    } finally {
      await daemon.stop()
    }
  })

  it("forwards a matching token and strips the session header upstream", async () => {
    const seen: Array<{
      path: string
      authorization: string | undefined
      session?: string | undefined
    }> = []
    const proxy = await startRecordingProxy(seen)
    const daemon = new LocalDaemon({
      port: 0,
      sessionToken,
      choose: () => ({ id: "a", authorization: "pool-token", proxyUrl: proxy.url }),
      runAuthorized: async (operation) => operation(new AbortController().signal),
    })
    await daemon.start()
    try {
      const response = await fetch(`http://127.0.0.1:${daemon.port}/v1/messages`, {
        method: "POST",
        headers: {
          authorization: "Bearer from-claude",
          "x-pigclaude-session": sessionToken,
        },
        body: "{}",
      })
      expect(response.status).toBe(200)
      expect(seen).toHaveLength(1)
      expect(seen[0]?.authorization).toBe("Bearer pool-token")
      expect(seen[0]?.session).toBeUndefined()
    } finally {
      try {
        await daemon.stop()
      } finally {
        await proxy.stop()
      }
    }
  })
})
