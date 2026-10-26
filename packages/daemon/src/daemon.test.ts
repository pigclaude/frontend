// 本机 daemon 测试。消息请求换成号池凭据，其它路径保留调用方凭据，代理不可用时关闭失败。额度用尽且响应体尚未写出时改用下一个账号。

import { request, type IncomingHttpHeaders } from "node:http"
import { describe, expect, it } from "vitest"
import { LocalDaemon } from "./daemon.ts"
import { startRecordingProxy, startScriptedProxy } from "./daemon-proxy-fixture.test.ts"

const sessionToken = "test-session-token"
const sessionHeaders = { "x-pigclaude-session": sessionToken }

describe("LocalDaemon", () => {
  it("replaces authorization only for message requests and fails closed when the proxy is down", async () => {
    const seen: string[] = []
    const daemon = new LocalDaemon({
      runAuthorized: async (operation) => operation(new AbortController().signal),
      port: 0,
      sessionToken,
      choose: () => ({ id: "a", authorization: "pool-token", proxyUrl: "http://127.0.0.1:1" }),
    })
    await daemon.start()
    try {
      const response = await fetch(`http://127.0.0.1:${daemon.port}/v1/messages`, {
        method: "POST",
        headers: {
          authorization: "Bearer from-claude",
          "content-type": "application/json",
          ...sessionHeaders,
        },
        body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
      })
      expect(response.status).toBe(503)
      expect(await response.json()).toEqual({ error: "proxy_unavailable" })
      expect(seen).toEqual([])
    } finally {
      await daemon.stop()
    }
  })

  it("sends the pool credential only on message posts", async () => {
    const seen: Array<{ path: string; authorization: string | undefined }> = []
    const proxy = await startRecordingProxy(seen)
    const daemon = new LocalDaemon({
      runAuthorized: async (operation) => operation(new AbortController().signal),
      port: 0,
      sessionToken,
      choose: (attempt) => {
        expect(attempt).toEqual({ rejectedIds: [] })
        return { id: "a", authorization: "pool-token", proxyUrl: proxy.url }
      },
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
      try {
        await daemon.stop()
      } finally {
        await proxy.stop()
      }
    }
  })

  it("forwards a gzip upstream as decoded bytes without compressed headers", async () => {
    const plain = "hello-gzip"
    const seen: Array<{ path: string; authorization: string | undefined }> = []
    const proxy = await startRecordingProxy(seen, { gzipPlain: plain })
    const daemon = new LocalDaemon({
      runAuthorized: async (operation) => operation(new AbortController().signal),
      port: 0,
      sessionToken,
      choose: () => ({ id: "a", authorization: "pool-token", proxyUrl: proxy.url }),
    })
    await daemon.start()
    try {
      const raw = await readHttp(daemon.port, "/v1/models")
      expect(raw.headers["content-encoding"]).toBeUndefined()
      expect(raw.headers["content-length"]).toBeUndefined()
      expect(raw.body.toString("utf8")).toBe(plain)
    } finally {
      try {
        await daemon.stop()
      } finally {
        await proxy.stop()
      }
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
    const daemon = new LocalDaemon({
      runAuthorized: async (operation) => operation(new AbortController().signal),
      port: 0,
      sessionToken,
      choose: () => ({ id: "a", authorization: "pool-token", proxyUrl: proxy.url }),
    })
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
    const daemon = new LocalDaemon({
      runAuthorized: async (operation) => operation(new AbortController().signal),
      port: 0,
      sessionToken,
      choose: () => ({ id: "a", authorization: "pool-token", proxyUrl: proxy.url }),
    })
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
    const daemon = new LocalDaemon({
      runAuthorized: async (operation) => operation(new AbortController().signal),
      port: 0,
      sessionToken,
      choose: () => ({ id: "a", authorization: "pool-token", proxyUrl: proxy.url }),
    })
    await daemon.start()
    try {
      const outcome = await readUntilClose(daemon.port, "/v1/models")
      expect(outcome.complete).toBe(false)
    } finally {
      try {
        await daemon.stop()
      } finally {
        await proxy.stop()
      }
    }
  })

  it("returns proxy_unavailable when choose returns null", async () => {
    const daemon = new LocalDaemon({
      runAuthorized: async (operation) => operation(new AbortController().signal),
      port: 0,
      sessionToken,
      choose: () => null,
    })
    await daemon.start()
    try {
      const response = await fetch(`http://127.0.0.1:${daemon.port}/v1/models`, {
        headers: sessionHeaders,
      })
      expect(response.status).toBe(503)
      expect(await response.json()).toEqual({ error: "proxy_unavailable" })
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
    const daemon = new LocalDaemon({
      runAuthorized: async (operation) => operation(new AbortController().signal),
      port: 0,
      sessionToken,
      choose: ({ rejectedIds }) =>
        rejectedIds.includes("a")
          ? { id: "b", authorization: "token-b", proxyUrl: proxy.url }
          : { id: "a", authorization: "token-a", proxyUrl: proxy.url },
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
      expect(calls).toBe(2)
    } finally {
      try {
        await daemon.stop()
      } finally {
        await proxy.stop()
      }
    }
  })

  it("does not send a second upstream request after the body has started", async () => {
    let calls = 0
    const proxy = await startScriptedProxy(async () => {
      calls += 1
      return { status: 200, body: "hello", trickle: true }
    })
    const daemon = new LocalDaemon({
      runAuthorized: async (operation) => operation(new AbortController().signal),
      port: 0,
      sessionToken,
      choose: () => ({ id: "a", authorization: "token-a", proxyUrl: proxy.url }),
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
    const daemon = new LocalDaemon({
      runAuthorized: async (operation) => operation(new AbortController().signal),
      port: 0,
      sessionToken,
      choose: ({ rejectedIds }) => {
        attempts.push([...rejectedIds])
        return rejectedIds.includes("a")
          ? null
          : { id: "a", authorization: "token-a", proxyUrl: proxy.url }
      },
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
      try {
        await daemon.stop()
      } finally {
        await proxy.stop()
      }
    }
  })

  it("does not retry a quota response when the request body exceeds 32 MiB", async () => {
    let calls = 0
    const attempts: string[][] = []
    const proxy = await startRecordingProxy([], async () => {
      calls += 1
      return { status: 429, headers: { "x-quota-exhausted": "1" }, body: "full" }
    })
    const daemon = new LocalDaemon({
      runAuthorized: async (operation) => operation(new AbortController().signal),
      port: 0,
      sessionToken,
      choose: ({ rejectedIds }) => {
        attempts.push([...rejectedIds])
        return rejectedIds.includes("a")
          ? { id: "b", authorization: "token-b", proxyUrl: proxy.url }
          : { id: "a", authorization: "token-a", proxyUrl: proxy.url }
      },
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
      try {
        await daemon.stop()
      } finally {
        await proxy.stop()
      }
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
