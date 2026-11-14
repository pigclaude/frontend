// 负责验证真实 daemon HTTP 在每个请求前核验会员，拒绝时不选号或访问代理。
import { expect, it, vi } from "vitest"
import { DaemonSessions, LocalDaemon } from "./daemon.ts"

const sessions = new DaemonSessions()
const sessionToken = sessions.register("authorization-session")
const sessionHeaders = { "x-pigclaude-session": sessionToken }

it("denies new requests when the required live authorization port rejects", async () => {
  const choose = vi.fn(() => ({
    id: "a",
    authorization: "claude-only",
    proxyUrl: "http://127.0.0.1:1",
  }))
  const runAuthorized = vi.fn(async () => {
    throw new Error("MEMBERSHIP_REQUIRED")
  })
  const daemon = new LocalDaemon({ port: 0, sessions, choose, runAuthorized })
  await daemon.start()
  try {
    for (const path of ["/v1/messages", "/v1/models"]) {
      const response = await fetch(`http://127.0.0.1:${daemon.port}${path}`, {
        headers: sessionHeaders,
      })
      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({ error: "membership_required" })
    }
    expect(runAuthorized).toHaveBeenCalledTimes(2)
    expect(choose).not.toHaveBeenCalled()
  } finally {
    await daemon.stop()
  }
})

it("already aborted authorization cannot forward even when a caller invokes the operation", async () => {
  const controller = new AbortController()
  controller.abort()
  const choose = vi.fn(() => null)
  const daemon = new LocalDaemon({
    port: 0,
    sessions,
    choose,
    runAuthorized: async (operation) => operation(controller.signal),
  })
  await daemon.start()
  try {
    const response = await fetch(`http://127.0.0.1:${daemon.port}/v1/messages`, {
      headers: sessionHeaders,
    })
    expect(response.status).toBe(403)
    expect(choose).not.toHaveBeenCalled()
  } finally {
    await daemon.stop()
  }
})

it("abort stops an already entered request while stop remains available without authorization", async () => {
  let entered: () => void = () => {}
  const chosen = new Promise<void>((resolve) => {
    entered = resolve
  })
  const controller = new AbortController()
  const daemon = new LocalDaemon({
    port: 0,
    sessions,
    runAuthorized: async (operation) => operation(controller.signal),
    choose: () => {
      entered()
      return { id: "a", authorization: "claude-only", proxyUrl: "http://127.0.0.1:1" }
    },
  })
  await daemon.start()
  // 不结束请求体，使实际 forward 停在 readBody；屏障由真实选号入口发出。
  const { request } = await import("node:http")
  const pending = new Promise<string>((resolve) => {
    const client = request({
      host: "127.0.0.1",
      port: daemon.port,
      path: "/v1/messages",
      method: "POST",
      headers: { "transfer-encoding": "chunked", ...sessionHeaders },
    })
    client.on("error", () => resolve("closed"))
    client.flushHeaders()
    client.write("{")
  })
  await chosen
  controller.abort()
  expect(await pending).toBe("closed")
  await daemon.stop()
})
