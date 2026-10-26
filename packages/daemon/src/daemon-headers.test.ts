// daemon 请求头测试。验证 OAuth beta 值按逗号去重合并，并且只替换消息请求的凭据。

import { describe, expect, it } from "vitest"
import { oauthBetaHeader } from "./daemon-headers.ts"
import { LocalDaemon } from "./daemon.ts"
import { startRecordingProxy } from "./daemon-proxy-fixture.test.ts"

const sessionToken = "headers-session-token"

describe("oauthBetaHeader", () => {
  it("adds the oauth beta value when no beta header exists", () => {
    expect(oauthBetaHeader(null)).toBe("oauth-2025-04-20")
    expect(oauthBetaHeader("")).toBe("oauth-2025-04-20")
  })

  it("keeps existing values, trims them and removes duplicates", () => {
    expect(oauthBetaHeader(" context-1m-2025-08-07, foo , foo ")).toBe(
      "context-1m-2025-08-07, foo, oauth-2025-04-20",
    )
  })

  it("does not repeat an existing oauth beta value", () => {
    expect(oauthBetaHeader("oauth-2025-04-20, foo")).toBe("oauth-2025-04-20, foo")
  })
})

describe("message authorization replacement", () => {
  it("merges the oauth beta value into the client beta header", async () => {
    const seen: Array<{
      path: string
      authorization: string | undefined
      session?: string | undefined
      beta?: string | undefined
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
          "anthropic-beta": "context-1m-2025-08-07, foo,foo",
          "x-pigclaude-session": sessionToken,
        },
        body: "{}",
      })
      expect(response.status).toBe(200)
      expect(seen).toHaveLength(1)
      expect(seen[0]?.authorization).toBe("Bearer pool-token")
      expect(seen[0]?.beta).toBe("context-1m-2025-08-07, foo, oauth-2025-04-20")
      expect(seen[0]?.session).toBeUndefined()
    } finally {
      try {
        await daemon.stop()
      } finally {
        await proxy.stop()
      }
    }
  })

  it("keeps the client authorization and beta header on non-message paths", async () => {
    const seen: Array<{
      path: string
      authorization: string | undefined
      beta?: string | undefined
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
      const response = await fetch(`http://127.0.0.1:${daemon.port}/v1/models`, {
        headers: {
          authorization: "Bearer from-claude",
          "anthropic-beta": "foo",
          "x-pigclaude-session": sessionToken,
        },
      })
      expect(response.status).toBe(200)
      expect(seen).toEqual([
        { path: "/v1/models", authorization: "Bearer from-claude", beta: "foo" },
      ])
    } finally {
      try {
        await daemon.stop()
      } finally {
        await proxy.stop()
      }
    }
  })
})
