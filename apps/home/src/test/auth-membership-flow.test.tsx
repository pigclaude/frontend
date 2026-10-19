// 负责验证 home 登录、会话刷新所需的 API 路径和会员状态读取。
import { describe, expect, it, vi } from "vitest"
import { createHomeApi } from "@pigclaude/api/home"
import type { HttpClient } from "@pigclaude/api/client"
import type { AuthUserView } from "@pigclaude/api/home/types"

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
    post: vi.fn(async <T,>(path: string) => {
      if (path === "/v1/auth/login" || path === "/v1/auth/register")
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
      return {} as T
    }),
    postForm: vi.fn(async () => ({})),
    put: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as unknown as HttpClient
}

describe("home auth and membership API flow", () => {
  it("logs in through the Rust path and then reads user/me plus entitlement", async () => {
    const client = fixtureClient()
    const api = createHomeApi(client)
    const authenticatedUser: AuthUserView = await api.auth.login({
      email: "ada@example.com",
      password: "correct horse",
    })
    const [me, entitlement] = await Promise.all([api.user.me(), api.membership.entitlement()])
    expect(client.post).toHaveBeenCalledWith("/v1/auth/login", {
      email: "ada@example.com",
      password: "correct horse",
    })
    expect(authenticatedUser.email).toBe("ada@example.com")
    expect(me.email).toBe("ada@example.com")
    expect(entitlement.status).toBe("expired")
    expect(JSON.stringify(entitlement)).not.toContain("secret")
  })

  it("returns the same AuthUserView DTO after registration", async () => {
    const api = createHomeApi(fixtureClient())
    const authenticatedUser: AuthUserView = await api.auth.register({
      email: "ada@example.com",
      password: "correct horse",
      nickname: "Ada",
    })
    expect(authenticatedUser.id).toBe("u-1")
    expect(authenticatedUser.membershipStatus).toBe("active")
  })
})
