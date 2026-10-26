// daemon 换号回调测试。额度用尽记为拒绝，首次选号和换号各触发一次选中；
// 响应正文开始写出之后不再换号，也不再触发选中回调。

import { describe, expect, it } from "vitest"
import { LocalDaemon } from "./daemon.ts"
import { startRecordingProxy, startScriptedProxy } from "./daemon-proxy-fixture.test.ts"

const sessionToken = "callbacks-session-token"

describe("account callbacks", () => {
  it("reports the quota rejection and both selections before the body is written", async () => {
    let calls = 0
    const selected: Array<[string, string | undefined]> = []
    const rejected: Array<[string, string]> = []
    const proxy = await startRecordingProxy([], async () => {
      calls += 1
      return calls === 1
        ? { status: 429, headers: { "x-quota-exhausted": "1" }, body: "" }
        : { status: 200, body: "ok" }
    })
    const daemon = new LocalDaemon({
      port: 0,
      sessionToken,
      runAuthorized: async (operation) => operation(new AbortController().signal),
      choose: ({ rejectedIds }) =>
        rejectedIds.includes("a")
          ? { id: "b", authorization: "token-b", proxyUrl: proxy.url }
          : { id: "a", authorization: "token-a", proxyUrl: proxy.url },
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
        headers: { "x-pigclaude-session": sessionToken },
        body: "{}",
      })
      expect(response.status).toBe(200)
      expect(await response.text()).toBe("ok")
      expect(selected).toEqual([
        ["a", undefined],
        ["b", "a"],
      ])
      expect(rejected).toEqual([["a", "quota"]])
    } finally {
      try {
        await daemon.stop()
      } finally {
        await proxy.stop()
      }
    }
  })

  it("awaits an asynchronous chooser before forwarding", async () => {
    const seen: Array<{ path: string; authorization: string | undefined }> = []
    const proxy = await startRecordingProxy(seen)
    let settled = false
    const daemon = new LocalDaemon({
      port: 0,
      sessionToken,
      runAuthorized: async (operation) => operation(new AbortController().signal),
      choose: async () => {
        await Promise.resolve()
        settled = true
        return { id: "a", authorization: "token-a", proxyUrl: proxy.url }
      },
    })
    await daemon.start()
    try {
      const response = await fetch(`http://127.0.0.1:${daemon.port}/v1/messages`, {
        method: "POST",
        headers: { "x-pigclaude-session": sessionToken },
        body: "{}",
      })
      expect(await response.text()).toBe("ok")
      expect(settled).toBe(true)
      expect(seen).toEqual([
        {
          path: "/v1/messages",
          authorization: "Bearer token-a",
          beta: "oauth-2025-04-20",
        },
      ])
    } finally {
      try {
        await daemon.stop()
      } finally {
        await proxy.stop()
      }
    }
  })

  it("does not select another account after the response body has started", async () => {
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
        headers: { "x-pigclaude-session": sessionToken },
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
})
