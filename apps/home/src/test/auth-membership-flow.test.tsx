// 负责验证 home 登录、会话刷新所需的 API 路径和会员状态读取。
import { describe, expect, it, vi } from "vitest"
import { createHomeApi } from "@pigclaude/api/home"
import type { HttpClient } from "@pigclaude/api"

function fixtureClient(): HttpClient {
  return {
    get: vi.fn(async <T,>(path: string) => {
      if (path === "/v1/user/me")
        return {
          id: "u-1",
          nickname: "Ada",
          avatar: "",
          email: "ada@example.com",
          balance: "0",
          createdAt: "2026-01-01T00:00:00Z",
          productCode: "pigclaude",
          planKind: "day",
          membershipStatus: "active",
          validUntil: null,
        } as T
      if (path === "/v1/entitlement")
        return {
          productCode: "pigclaude",
          planKind: "day",
          status: "expired",
          lifetime: false,
          validUntil: "2026-01-02T00:00:00Z",
          termsVersion: "1",
          termsAcceptedAt: null,
          entitlementVersion: "2",
        } as T
      throw new Error(`unexpected GET ${path}`)
    }),
    post: vi.fn(async () => ({})),
    postForm: vi.fn(async () => ({})),
    put: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as unknown as HttpClient
}

describe("home auth and membership API flow", () => {
  it("logs in through the Rust path and then reads user/me plus entitlement", async () => {
    const client = fixtureClient()
    const api = createHomeApi(client)
    await api.auth.login({ email: "ada@example.com", password: "correct horse" })
    const [me, entitlement] = await Promise.all([api.user.me(), api.membership.entitlement()])
    expect(client.post).toHaveBeenCalledWith("/v1/auth/login", {
      email: "ada@example.com",
      password: "correct horse",
    })
    expect(me.email).toBe("ada@example.com")
    expect(entitlement.status).toBe("expired")
    expect(JSON.stringify(entitlement)).not.toContain("secret")
  })
})
