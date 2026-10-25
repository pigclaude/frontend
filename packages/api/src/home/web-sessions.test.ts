// 负责验证网页登录 client 每次写入先读取会话 CSRF，并拒绝失效 owner。
import { expect, it } from "vitest"
import { createClient, StaleSessionResponse } from "../client"
import { createWebSessionsApi } from "./web-sessions"

type Call = { method: string; path: string; body: unknown }

/** 返回 JSON 响应，保持与真实 client 相同的解析路径。 */
function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  })
}

it("lists sessions and signs out with the live session csrf", async () => {
  const calls: Call[] = []
  const api = createWebSessionsApi(
    createClient({
      fetch: async (path, init) => {
        calls.push({
          method: init?.method ?? "GET",
          path: String(path),
          body: init?.body ? (JSON.parse(String(init.body)) as unknown) : null,
        })
        if (String(path) === "/v1/session") return json({ csrf: "session-csrf" })
        if (String(path) === "/v1/user/web-sessions") return json([])
        return new Response(null, { status: 204 })
      },
    }),
  )

  await api.list()
  await api.revoke("session id/1", () => true)
  await api.revokeOthers(() => true)

  expect(calls.map(({ method, path }) => [method, path])).toEqual([
    ["GET", "/v1/user/web-sessions"],
    ["GET", "/v1/session"],
    ["POST", "/v1/user/web-sessions/session%20id%2F1/revoke"],
    ["GET", "/v1/session"],
    ["POST", "/v1/user/web-sessions/revoke-others"],
  ])
  expect(calls.filter(({ method }) => method === "POST").map(({ body }) => body)).toEqual([
    { csrf: "session-csrf" },
    { csrf: "session-csrf" },
  ])
})

it("throws StaleSessionResponse before any write when the owner is stale", async () => {
  let requests = 0
  const api = createWebSessionsApi(
    createClient({
      fetch: async () => {
        requests += 1
        return json({ csrf: "session-csrf" })
      },
    }),
  )
  await expect(api.revokeOthers(() => false)).rejects.toBeInstanceOf(StaleSessionResponse)
  expect(requests).toBe(0)
})
