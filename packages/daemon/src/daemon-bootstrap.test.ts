// daemon 端点白名单测试。只有消息接口和模型目录读取的 bootstrap 换成号池凭据，
// 其他非消息端点保留调用方的头；bootstrap 不参与换号，也不改账号状态。
// bootstrap 按账号代理或系统网络出网：这里的无 dispatcher 请求就是直连，会被记录。

import { beforeEach, describe, expect, it, vi } from "vitest"
import { DaemonSessions, LocalDaemon } from "./daemon.ts"
import { startRecordingProxy } from "./daemon-proxy-fixture.test.ts"

const directUpstream = vi.hoisted(() => ({
  calls: [] as Array<{ url: string; authorization: string | null }>,
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
      directUpstream.calls.push({
        url: String(input),
        authorization: new Headers(init?.headers).get("authorization"),
      })
      return Promise.resolve(new actual.Response("direct-ok", { status: 200 }))
    },
  }
})

const sessions = new DaemonSessions()
const sessionToken = sessions.register("bootstrap-session")
const sessionHeaders = { "x-pigclaude-session": sessionToken }
const bootstrapPath = "/api/claude_cli/bootstrap?entrypoint=sdk-ts&model=claude-sonnet-5-5"

type ChooseAccount = ConstructorParameters<typeof LocalDaemon>[0]["choose"]

function testDaemon(choose: ChooseAccount): LocalDaemon {
  return new LocalDaemon({
    port: 0,
    sessions,
    runAuthorized: async (operation) => operation(new AbortController().signal),
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

describe("bootstrap endpoint", () => {
  beforeEach(() => {
    directUpstream.calls.length = 0
  })

  it("uses the system network for an account without a proxy", async () => {
    const daemon = testDaemon(() => ({ id: "a", authorization: "pool-token", proxyUrl: null }))
    await daemon.start()
    try {
      const response = await fetch(`http://127.0.0.1:${daemon.port}${bootstrapPath}`, {
        headers: sessionHeaders,
      })
      expect(response.status).toBe(200)
      expect(directUpstream.calls).toEqual([
        { url: `https://api.anthropic.com${bootstrapPath}`, authorization: "Bearer pool-token" },
      ])
    } finally {
      await daemon.stop()
    }
  })

  it.each(["http://127.0.0.1:1", ""])(
    "fails with proxy_unavailable when the bound proxy %j is unusable and never connects directly",
    async (proxyUrl) => {
      const daemon = testDaemon(() => ({ id: "a", authorization: "pool-token", proxyUrl }))
      await daemon.start()
      try {
        const response = await fetch(`http://127.0.0.1:${daemon.port}${bootstrapPath}`, {
          headers: sessionHeaders,
        })
        expect(response.status).toBe(503)
        expect(await response.json()).toEqual({ error: "proxy_unavailable" })
        expect(directUpstream.calls).toEqual([])
      } finally {
        await daemon.stop()
      }
    },
  )

  it("sends the chosen account's credential and OAuth beta through its proxy", async () => {
    const seen: Array<{ path: string; authorization: string | undefined }> = []
    const proxy = await startRecordingProxy(seen)
    const daemon = testDaemon(() => ({ id: "a", authorization: "pool-token", proxyUrl: proxy.url }))
    await daemon.start()
    try {
      const response = await fetch(`http://127.0.0.1:${daemon.port}${bootstrapPath}`, {
        headers: { "anthropic-beta": "oauth-2025-04-20", ...sessionHeaders },
      })
      expect(response.status).toBe(200)
      expect(seen).toEqual([
        {
          path: bootstrapPath,
          authorization: "Bearer pool-token",
          beta: "oauth-2025-04-20",
        },
      ])
    } finally {
      await stopBoth(daemon, proxy)
    }
  })

  it("keeps the caller's headers on other non-message endpoints and still swaps message posts", async () => {
    const seen: Array<{ path: string; authorization: string | undefined }> = []
    const proxy = await startRecordingProxy(seen)
    const daemon = testDaemon(() => ({ id: "a", authorization: "pool-token", proxyUrl: proxy.url }))
    const caller = { authorization: "Bearer pigclaude-local", ...sessionHeaders }
    await daemon.start()
    try {
      const requests: Array<[string, RequestInit]> = [
        [bootstrapPath, { method: "POST", headers: caller, body: "{}" }],
        ["/api/claude_cli/bootstrap/", { headers: caller }],
        ["/api/claude_cli/bootstrapx", { headers: caller }],
        ["/api/claude_code/settings", { headers: caller }],
        ["/v1/messages", { method: "POST", headers: caller, body: "{}" }],
      ]
      for (const [path, init] of requests) {
        const response = await fetch(`http://127.0.0.1:${daemon.port}${path}`, init)
        await response.text()
      }
      expect(seen).toEqual([
        { path: bootstrapPath, authorization: "Bearer pigclaude-local" },
        { path: "/api/claude_cli/bootstrap/", authorization: "Bearer pigclaude-local" },
        { path: "/api/claude_cli/bootstrapx", authorization: "Bearer pigclaude-local" },
        { path: "/api/claude_code/settings", authorization: "Bearer pigclaude-local" },
        { path: "/v1/messages", authorization: "Bearer pool-token", beta: "oauth-2025-04-20" },
      ])
    } finally {
      await stopBoth(daemon, proxy)
    }
  })

  it.each([
    { status: 401, headers: {} },
    { status: 403, headers: {} },
    { status: 429, headers: { "x-quota-exhausted": "1" } },
  ])(
    "returns a $status as is without switching, rejecting or reporting the account",
    async ({ status, headers }) => {
      const attempts: string[][] = []
      const selected: string[] = []
      const rejected: string[] = []
      const proxy = await startRecordingProxy([], () => ({ status, headers, body: "refused" }))
      const daemon = new LocalDaemon({
        port: 0,
        sessions,
        runAuthorized: async (operation) => operation(new AbortController().signal),
        choose: ({ rejectedIds }) => {
          attempts.push([...rejectedIds])
          return rejectedIds.includes("a")
            ? { id: "b", authorization: "token-b", proxyUrl: proxy.url }
            : { id: "a", authorization: "token-a", proxyUrl: proxy.url }
        },
        onAccountSelected: (_sessionId, accountId) => selected.push(accountId),
        onAccountRejected: (_sessionId, accountId) => rejected.push(accountId),
      })
      await daemon.start()
      try {
        const response = await fetch(`http://127.0.0.1:${daemon.port}${bootstrapPath}`, {
          headers: sessionHeaders,
        })
        expect(response.status).toBe(status)
        expect(await response.text()).toBe("refused")
        expect(attempts).toEqual([[]])
        expect(selected).toEqual([])
        expect(rejected).toEqual([])
      } finally {
        await stopBoth(daemon, proxy)
      }
    },
  )
})
