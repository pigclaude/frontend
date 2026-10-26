// 额度用尽之后的代理失败测试。保存过 429 时，抛错的代理会换下一个账号；第一次就没有代理时仍返回 proxy_unavailable，并且不会直连上游。

import { beforeEach, describe, expect, it, vi } from "vitest"
import { LocalDaemon } from "./daemon.ts"
import { startRecordingProxy } from "./daemon-proxy-fixture.test.ts"

const directConnections = vi.hoisted(() => [] as string[])

const sessionToken = "quota-proxy-session-token"
const sessionHeaders = { "x-pigclaude-session": sessionToken }

vi.mock("undici", async () => {
  const actual = await vi.importActual<typeof import("undici")>("undici")
  return {
    ProxyAgent: actual.ProxyAgent,
    fetch: (
      input: Parameters<typeof actual.fetch>[0],
      init?: Parameters<typeof actual.fetch>[1],
    ): ReturnType<typeof actual.fetch> => {
      if (init?.dispatcher === undefined) {
        directConnections.push(String(input))
        return Promise.reject(new Error("direct connection"))
      }
      return actual.fetch(input, init)
    },
  }
})

describe("quota proxy failover", () => {
  beforeEach(() => {
    directConnections.length = 0
  })

  it("tries the next account when a proxy throws after a saved quota response", async () => {
    const seen: Array<{ path: string; authorization: string | undefined }> = []
    const attempts: string[][] = []
    const proxy = await startRecordingProxy(seen, () => {
      const authorization = seen.at(-1)?.authorization
      if (authorization === "Bearer token-a") {
        return { status: 429, headers: { "x-quota-exhausted": "1" }, body: "exhausted" }
      }
      return { status: 200, body: "from-c" }
    })
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
          return { id: "b", authorization: "token-b", proxyUrl: "http://127.0.0.1:1" }
        }
        return { id: "c", authorization: "token-c", proxyUrl: proxy.url }
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
      expect(await response.text()).toBe("from-c")
      expect(attempts).toEqual([[], ["a"], ["a", "b"]])
      expect(seen.map((item) => item.authorization)).toEqual(["Bearer token-a", "Bearer token-c"])
      expect(directConnections).toEqual([])
    } finally {
      try {
        await daemon.stop()
      } finally {
        await proxy.stop()
      }
    }
  })

  it("returns proxy_unavailable when the first proxy throws and no quota response is saved", async () => {
    const attempts: string[][] = []
    const daemon = new LocalDaemon({
      port: 0,
      sessionToken,
      runAuthorized: async (operation) => operation(new AbortController().signal),
      choose: ({ rejectedIds }) => {
        attempts.push([...rejectedIds])
        return { id: "a", authorization: "pool-token", proxyUrl: "http://127.0.0.1:1" }
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
      expect(await response.json()).toEqual({ error: "proxy_unavailable" })
      expect(attempts).toEqual([[]])
      expect(directConnections).toEqual([])
    } finally {
      await daemon.stop()
    }
  })
})
