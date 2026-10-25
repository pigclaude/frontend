// 负责验证修改昵称先读取会话 CSRF，并返回更新后的用户资料。

import { expect, it } from "vitest"
import { StaleSessionResponse, createClient } from "../client"
import { createHomeApi } from "./endpoints"

type Call = { method: string; path: string; body: unknown }

/** 返回 JSON 响应，保持与真实 client 相同的解析路径。 */
function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  })
}

/** 构造要返回的 me 视图，余额字段已从契约删除。 */
function me(nickname: string) {
  return {
    id: "100001",
    nickname,
    avatar: "",
    email: "profile@example.test",
    createdAt: "2026-10-01T00:00:00Z",
    emailVerified: true,
    hasPassword: true,
    passwordChangedAt: null,
  }
}

it("updates the nickname with the live session csrf", async () => {
  const calls: Call[] = []
  const api = createHomeApi(
    createClient({
      fetch: async (path, init) => {
        const method = init?.method ?? "GET"
        calls.push({
          method,
          path: String(path),
          body: init?.body ? (JSON.parse(String(init.body)) as unknown) : null,
        })
        if (String(path) === "/v1/session") return json({ csrf: "session-csrf" })
        return json(me("林小猪"))
      },
    }),
  )

  const updated = await api.user.updateProfile({ nickname: "林小猪" }, () => true)

  expect(updated.nickname).toBe("林小猪")
  expect(calls).toEqual([
    { method: "GET", path: "/v1/session", body: null },
    {
      method: "PATCH",
      path: "/v1/user/profile",
      body: { nickname: "林小猪", csrf: "session-csrf" },
    },
  ])
})

it("does not write when the owner is stale", async () => {
  let requests = 0
  const api = createHomeApi(
    createClient({
      fetch: async () => {
        requests += 1
        return json({ csrf: "session-csrf" })
      },
    }),
  )

  await expect(api.user.updateProfile({ nickname: "林小猪" }, () => false)).rejects.toBeInstanceOf(
    StaleSessionResponse,
  )
  expect(requests).toBe(0)
})
