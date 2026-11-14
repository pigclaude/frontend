// 本机 daemon 测试。消息请求换成号池凭据，/v1/models 这类路径保留调用方凭据；
// 直连账号使用不带 dispatcher 的 fetch，代理或直连不可用时按各自错误码失败。
// 额度用尽且响应体尚未写出时改用下一个账号。

import { request, type IncomingHttpHeaders } from "node:http"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { DaemonSessions, LocalDaemon } from "./daemon.ts"
import { startRecordingProxy } from "./daemon-proxy-fixture.test.ts"

const directUpstream = vi.hoisted(() => ({
  calls: [] as Array<{ url: string; authorization: string | null; beta: string | null }>,
  fail: false,
  failOnCall: 0,
}))

vi.mock("undici", async () => {
  const actual = await vi.importActual<typeof import("undici")>("undici")
  return {
    ProxyAgent: actual.ProxyAgent,
    fetch: (
      input: Parameters<typeof actual.fetch>[0],
      init?: Parameters<typeof actual.fetch>[1],
    ): ReturnType<typeof actual.fetch> => {
      if (init?.dispatcher !== undefined) return actual.fetch(input, init)
      const headers = new Headers(init?.headers)
      directUpstream.calls.push({
        url: String(input),
        authorization: headers.get("authorization"),
        beta: headers.get("anthropic-beta"),
      })
      if (directUpstream.fail || directUpstream.calls.length === directUpstream.failOnCall) {
        return Promise.reject(new Error("direct connection refused"))
      }
      return Promise.resolve(new actual.Response("direct-ok", { status: 200 }))
    },
  }
})

const sessions = new DaemonSessions()
const sessionHeaders = { "x-pigclaude-session": sessions.register("test-session") }

type ChooseAccount = ConstructorParameters<typeof LocalDaemon>[0]["choose"]

// 用统一的授权信号和会话令牌创建测试 daemon，避免每个用例重复四行装配。
function testDaemon(choose: ChooseAccount): LocalDaemon {
  return new LocalDaemon({
    runAuthorized: async (operation) => operation(new AbortController().signal),
    port: 0,
    sessions,
    choose,
  })
}

// 先停 daemon 再停记录代理，保证代理连接全部释放后再结束用例。
async function stopBoth(daemon: LocalDaemon, proxy: { stop: () => Promise<void> }): Promise<void> {
  try {
    await daemon.stop()
  } finally {
    await proxy.stop()
  }
}

describe("LocalDaemon", () => {
  beforeEach(() => {
    directUpstream.calls.length = 0
    directUpstream.fail = false
    directUpstream.failOnCall = 0
  })

  it("uses fetch without a dispatcher when the chosen account has no proxy", async () => {
    const daemon = testDaemon(() => ({ id: "a", authorization: "pool-token", proxyUrl: null }))
    await daemon.start()
    try {
      const response = await fetch(`http://127.0.0.1:${daemon.port}/v1/messages`, {
        method: "POST",
        headers: {
          authorization: "Bearer from-claude",
          "anthropic-beta": "context-1m-2025-08-07",
          ...sessionHeaders,
        },
        body: "{}",
      })
      expect(response.status).toBe(200)
      expect(await response.text()).toBe("direct-ok")
      expect(directUpstream.calls).toEqual([
        {
          url: "https://api.anthropic.com/v1/messages",
          authorization: "Bearer pool-token",
          beta: "context-1m-2025-08-07, oauth-2025-04-20",
        },
      ])
    } finally {
      await daemon.stop()
    }
  })

  it("returns upstream_unavailable when the direct connection fails", async () => {
    directUpstream.fail = true
    const daemon = testDaemon(() => ({ id: "a", authorization: "pool-token", proxyUrl: null }))
    await daemon.start()
    try {
      const response = await fetch(`http://127.0.0.1:${daemon.port}/v1/messages`, {
        method: "POST",
        headers: sessionHeaders,
        body: "{}",
      })
      expect(response.status).toBe(502)
      expect(await response.json()).toEqual({ error: "upstream_unavailable" })
      expect(directUpstream.calls).toHaveLength(1)
    } finally {
      await daemon.stop()
    }
  })

  it("sends the pool credential only on message posts", async () => {
    const seen: Array<{ path: string; authorization: string | undefined }> = []
    const proxy = await startRecordingProxy(seen)
    const daemon = testDaemon((attempt) => {
      expect(attempt).toEqual({ sessionId: "test-session", rejectedIds: [] })
      return { id: "a", authorization: "pool-token", proxyUrl: proxy.url }
    })
    await daemon.start()
    try {
      await fetch(`http://127.0.0.1:${daemon.port}/v1/messages`, {
        method: "POST",
        headers: { authorization: "Bearer from-claude", ...sessionHeaders },
        body: "{}",
      })
      await fetch(`http://127.0.0.1:${daemon.port}/v1/models`, {
        headers: { authorization: "Bearer from-claude", ...sessionHeaders },
      })
      expect(seen).toEqual([
        {
          path: "/v1/messages",
          authorization: "Bearer pool-token",
          beta: "oauth-2025-04-20",
        },
        { path: "/v1/models", authorization: "Bearer from-claude" },
      ])
    } finally {
      await stopBoth(daemon, proxy)
    }
  })

  it("forwards a gzip upstream as decoded bytes without compressed headers", async () => {
    const plain = "hello-gzip"
    const seen: Array<{ path: string; authorization: string | undefined }> = []
    const proxy = await startRecordingProxy(seen, { gzipPlain: plain })
    const daemon = testDaemon(() => ({
      id: "a",
      authorization: "pool-token",
      proxyUrl: proxy.url,
    }))
    await daemon.start()
    try {
      const raw = await readHttp(daemon.port, "/v1/models")
      expect(raw.headers["content-encoding"]).toBeUndefined()
      expect(raw.headers["content-length"]).toBeUndefined()
      expect(raw.body.toString("utf8")).toBe(plain)
    } finally {
      await stopBoth(daemon, proxy)
    }
  })

  it("closes the upstream tunnel when the client stops a streamed reply", async () => {
    let openTunnels = 0
    const seen: Array<{ path: string; authorization: string | undefined }> = []
    const proxy = await startRecordingProxy(seen, {
      holdBody: true,
      onTunnel: (event) => {
        openTunnels += event === "open" ? 1 : -1
      },
    })
    const daemon = testDaemon(() => ({
      id: "a",
      authorization: "pool-token",
      proxyUrl: proxy.url,
    }))
    await daemon.start()
    const rejections: unknown[] = []
    const onRejection = (reason: unknown): void => {
      rejections.push(reason)
    }
    process.on("unhandledRejection", onRejection)
    try {
      const streamed = await readFirstChunk(daemon.port, "/v1/models")
      expect(streamed.chunk.toString("utf8")).toBe("hello-held")
      streamed.destroy()
      await waitUntil(() => openTunnels === 0)
      expect(rejections).toEqual([])
    } finally {
      process.off("unhandledRejection", onRejection)
      try {
        await daemon.stop()
      } finally {
        await proxy.stop()
      }
    }
  })

  it("does not crash when the client aborts before the response starts", async () => {
    const seen: Array<{ path: string; authorization: string | undefined }> = []
    const proxy = await startRecordingProxy(seen)
    const daemon = testDaemon(() => ({
      id: "a",
      authorization: "pool-token",
      proxyUrl: proxy.url,
    }))
    await daemon.start()
    const rejections: unknown[] = []
    const onRejection = (reason: unknown): void => {
      rejections.push(reason)
    }
    process.on("unhandledRejection", onRejection)
    try {
      await abortPartialPost(daemon.port)
      await delay(50)
      expect(rejections).toEqual([])
    } finally {
      process.off("unhandledRejection", onRejection)
      try {
        await daemon.stop()
      } finally {
        await proxy.stop()
      }
    }
  })

  it("does not complete the client response when the upstream body errors", async () => {
    const seen: Array<{ path: string; authorization: string | undefined }> = []
    const proxy = await startRecordingProxy(seen, { brokenGzip: true })
    const daemon = testDaemon(() => ({
      id: "a",
      authorization: "pool-token",
      proxyUrl: proxy.url,
    }))
    await daemon.start()
    try {
      const outcome = await readUntilClose(daemon.port, "/v1/models")
      expect(outcome.complete).toBe(false)
    } finally {
      await stopBoth(daemon, proxy)
    }
  })

  it("returns no_available_account when choose returns null", async () => {
    const daemon = testDaemon(() => null)
    await daemon.start()
    try {
      const response = await fetch(`http://127.0.0.1:${daemon.port}/v1/models`, {
        headers: sessionHeaders,
      })
      expect(response.status).toBe(503)
      expect(await response.json()).toEqual({ error: "no_available_account" })
    } finally {
      await daemon.stop()
    }
  })

  it("retries the same message request with the next credential before any body byte is written", async () => {
    let calls = 0
    const proxy = await startRecordingProxy([], async () => {
      calls += 1
      return calls === 1
        ? { status: 429, headers: { "x-quota-exhausted": "1" }, body: "" }
        : { status: 200, body: "ok" }
    })
    const daemon = testDaemon(({ rejectedIds }) =>
      rejectedIds.includes("a")
        ? { id: "b", authorization: "token-b", proxyUrl: proxy.url }
        : { id: "a", authorization: "token-a", proxyUrl: proxy.url },
    )
    await daemon.start()
    try {
      const response = await fetch(`http://127.0.0.1:${daemon.port}/v1/messages`, {
        method: "POST",
        headers: sessionHeaders,
        body: "{}",
      })
      expect(response.status).toBe(200)
      expect(await response.text()).toBe("ok")
      expect(calls).toBe(2)
    } finally {
      await stopBoth(daemon, proxy)
    }
  })

  it("continues past a failed direct retry after saving a quota response", async () => {
    const attempts: string[][] = []
    const proxy = await startRecordingProxy([], async () => ({
      status: 429,
      headers: { "x-quota-exhausted": "1", "content-type": "application/json" },
      body: '{"error":"exhausted"}',
    }))
    directUpstream.failOnCall = 1
    const daemon = testDaemon(({ rejectedIds }) => {
      attempts.push([...rejectedIds])
      if (!rejectedIds.includes("a")) {
        return { id: "a", authorization: "token-a", proxyUrl: proxy.url }
      }
      return rejectedIds.includes("b")
        ? { id: "c", authorization: "token-c", proxyUrl: null }
        : { id: "b", authorization: "token-b", proxyUrl: null }
    })
    await daemon.start()
    try {
      const response = await fetch(`http://127.0.0.1:${daemon.port}/v1/messages`, {
        method: "POST",
        headers: sessionHeaders,
        body: "{}",
      })
      expect(response.status).toBe(200)
      expect(await response.text()).toBe("direct-ok")
      expect(directUpstream.calls.map((call) => call.authorization)).toEqual([
        "Bearer token-b",
        "Bearer token-c",
      ])
      expect(attempts).toEqual([[], ["a"], ["a", "b"]])
    } finally {
      await stopBoth(daemon, proxy)
    }
  })

  it("returns the last quota response when the next account is unavailable", async () => {
    let calls = 0
    const attempts: string[][] = []
    const proxy = await startRecordingProxy([], async () => {
      calls += 1
      return {
        status: 429,
        headers: { "x-quota-exhausted": "1", "content-type": "application/json" },
        body: '{"error":"exhausted"}',
      }
    })
    const daemon = testDaemon(({ rejectedIds }) => {
      attempts.push([...rejectedIds])
      return rejectedIds.includes("a")
        ? null
        : { id: "a", authorization: "token-a", proxyUrl: proxy.url }
    })
    await daemon.start()
    try {
      const response = await fetch(`http://127.0.0.1:${daemon.port}/v1/messages`, {
        method: "POST",
        headers: sessionHeaders,
        body: "{}",
      })
      expect(response.status).toBe(429)
      expect(response.headers.get("x-quota-exhausted")).toBe("1")
      expect(await response.text()).toBe('{"error":"exhausted"}')
      expect(calls).toBe(1)
      expect(attempts).toEqual([[], ["a"]])
    } finally {
      await stopBoth(daemon, proxy)
    }
  })

  it("does not retry a quota response when the request body exceeds 32 MiB", async () => {
    let calls = 0
    const attempts: string[][] = []
    const proxy = await startRecordingProxy([], async () => {
      calls += 1
      return { status: 429, headers: { "x-quota-exhausted": "1" }, body: "full" }
    })
    const daemon = testDaemon(({ rejectedIds }) => {
      attempts.push([...rejectedIds])
      return rejectedIds.includes("a")
        ? { id: "b", authorization: "token-b", proxyUrl: proxy.url }
        : { id: "a", authorization: "token-a", proxyUrl: proxy.url }
    })
    await daemon.start()
    try {
      const response = await fetch(`http://127.0.0.1:${daemon.port}/v1/messages`, {
        method: "POST",
        body: Buffer.alloc(32 * 1024 * 1024 + 1),
        headers: { "content-type": "application/json", ...sessionHeaders },
      })
      expect(response.status).toBe(429)
      expect(await response.text()).toBe("full")
      expect(calls).toBe(1)
      expect(attempts).toEqual([[]])
    } finally {
      await stopBoth(daemon, proxy)
    }
  })
})

function readHttp(
  port: number,
  path: string,
): Promise<{ headers: IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = request(
      { hostname: "127.0.0.1", port, path, method: "GET", headers: sessionHeaders },
      (response) => {
        const chunks: Buffer[] = []
        let settled = false
        const finish = (): void => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve({ headers: response.headers, body: Buffer.concat(chunks) })
        }
        const timer = setTimeout(() => {
          req.destroy()
          finish()
        }, 300)
        response.on("data", (chunk: Buffer) => {
          chunks.push(chunk)
        })
        response.on("end", finish)
        response.on("error", finish)
      },
    )
    req.on("error", reject)
    req.end()
  })
}
function readUntilClose(port: number, path: string): Promise<{ complete: boolean }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out")), 1000)
    let sawResponse = false
    const finish = (complete: boolean): void => {
      clearTimeout(timer)
      resolve({ complete })
    }
    const req = request(
      { hostname: "127.0.0.1", port, path, method: "GET", headers: sessionHeaders },
      (response) => {
        sawResponse = true
        response.on("data", () => undefined)
        response.on("error", () => undefined)
        response.on("close", () => finish(response.complete))
      },
    )
    req.on("error", () => {
      if (!sawResponse) finish(false)
    })
    req.end()
  })
}
function readFirstChunk(
  port: number,
  path: string,
): Promise<{ chunk: Buffer; destroy: () => void }> {
  return new Promise((resolve, reject) => {
    const req = request(
      { hostname: "127.0.0.1", port, path, method: "GET", headers: sessionHeaders },
      (response) => {
        const timer = setTimeout(() => {
          req.destroy()
          reject(new Error("no streamed bytes"))
        }, 500)
        response.once("data", (chunk: Buffer) => {
          clearTimeout(timer)
          resolve({ chunk, destroy: () => req.destroy() })
        })
        response.on("error", () => undefined)
      },
    )
    req.on("error", reject)
    req.end()
  })
}
function abortPartialPost(port: number): Promise<void> {
  return new Promise((resolve) => {
    const req = request(
      {
        hostname: "127.0.0.1",
        port,
        path: "/v1/messages",
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": "32",
          ...sessionHeaders,
        },
      },
      () => undefined,
    )
    req.on("error", () => undefined)
    req.write("{")
    setTimeout(() => {
      req.destroy()
      resolve()
    }, 30)
  })
}
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}
async function waitUntil(ready: () => boolean): Promise<void> {
  const deadline = Date.now() + 1000
  while (!ready()) {
    if (Date.now() > deadline) throw new Error("timed out")
    await delay(10)
  }
}
