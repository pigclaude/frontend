// 负责验证 home 登录、会话刷新所需的 API 路径和会员状态读取。
import { describe, expect, it, vi } from "vitest"
import { createHomeApi } from "@pigclaude/api/home"
import type { HttpClient } from "@pigclaude/api/client"

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

describe("Home post-OIDC membership API", () => {
  it("reads user and authoritative entitlement independently after server callback", async () => {
    const client = fixtureClient()
    const api = createHomeApi(client)
    const [me, entitlement] = await Promise.all([api.user.me(), api.membership.entitlement()])
    expect(me.email).toBe("ada@example.com")
    expect(me.membershipStatus).toBe("active")
    expect(entitlement.status).toBe("expired")
    expect(client.post).not.toHaveBeenCalled()
    expect("login" in api.auth).toBe(false)
    expect("register" in api.auth).toBe(false)
    expect(JSON.stringify(entitlement)).not.toContain("secret")
  })
})
