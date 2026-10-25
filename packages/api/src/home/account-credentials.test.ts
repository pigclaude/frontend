// 负责验证账号凭据 client 每次写入先读取会话 CSRF，并拒绝失效 owner。

import { expect, it } from "vitest"
import { createClient, StaleSessionResponse } from "../client"
import { createAccountCredentialApi } from "./account-credentials"

type Call = { method: string; path: string; body: unknown }

/** 返回 JSON 响应，保持与真实 client 相同的解析路径。 */
function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  })
}

it("reads the live session csrf before every credential write", async () => {
  const calls: Call[] = []
  const api = createAccountCredentialApi(
    createClient({
      fetch: async (path, init) => {
        const method = init?.method ?? "GET"
        calls.push({
          method,
          path: String(path),
          body: init?.body ? (JSON.parse(String(init.body)) as unknown) : null,
        })
        switch (String(path)) {
          case "/v1/session":
            return json({ csrf: "session-csrf" })
          case "/v1/user/email-code":
            return json({ type: "sent", resendAfterSeconds: 60 })
          case "/v1/user/email":
            return json({ email: "next@example.test" })
          default:
            return json({ type: "password_changed" })
        }
      },
    }),
  )

  await api.sendCode({ purpose: "change_email", email: "next@example.test" }, () => true)
  await api.changeEmail({ email: "next@example.test", emailCode: "123456" }, () => true)
  await api.changePassword({ emailCode: "654321", newPassword: "new-password-1" }, () => true)

  expect(calls.map(({ method, path }) => [method, path])).toEqual([
    ["GET", "/v1/session"],
    ["POST", "/v1/user/email-code"],
    ["GET", "/v1/session"],
    ["POST", "/v1/user/email"],
    ["GET", "/v1/session"],
    ["POST", "/v1/user/password"],
  ])
  expect(calls.filter(({ method }) => method === "POST").map(({ body }) => body)).toEqual([
    { purpose: "change_email", email: "next@example.test", csrf: "session-csrf" },
    { email: "next@example.test", emailCode: "123456", csrf: "session-csrf" },
    { emailCode: "654321", newPassword: "new-password-1", csrf: "session-csrf" },
  ])
})

it("throws StaleSessionResponse when the owner changes during a write", async () => {
  let current = true
  let writes = 0
  const api = createAccountCredentialApi(
    createClient({
      fetch: async (path) => {
        if (String(path) === "/v1/session") {
          current = false
          return json({ csrf: "session-csrf" })
        }
        writes += 1
        return json({ type: "sent", resendAfterSeconds: 60 })
      },
    }),
  )

  await expect(api.sendCode({ purpose: "password" }, () => current)).rejects.toBeInstanceOf(
    StaleSessionResponse,
  )
  expect(writes).toBe(0)
})

it("throws StaleSessionResponse before any request when the owner is stale", async () => {
  let requests = 0
  const api = createAccountCredentialApi(
    createClient({
      fetch: async () => {
        requests += 1
        return json({ csrf: "session-csrf" })
      },
    }),
  )
  await expect(
    api.changePassword({ emailCode: "123456", newPassword: "new-password-1" }, () => false),
  ).rejects.toBeInstanceOf(StaleSessionResponse)
  expect(requests).toBe(0)
})
