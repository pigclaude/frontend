// 负责验证授权服务使用 标准 OAuth context，而不是本地 fixture exchange。
import { describe, expect, it } from "vitest"
import { AuthorizationService } from "./service"
import type { AuthorizationRequest, AuthorizationToken } from "./types"
import type { SecretVault } from "../secret-vault"

class MemoryVault implements SecretVault {
  readonly values = new Map<string, string>()

  async set(key: string, value: string): Promise<void> {
    this.values.set(key, value)
  }

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key)
  }
}

const loginRequest: AuthorizationRequest = { purpose: "pigclaude-login", mode: "login" }

function token(): AuthorizationToken {
  return {
    accessToken: "access-secret",
    refreshToken: "refresh-secret",
    accountId: "user-1",
    displayName: "林舟",
    expiresAt: 2_000_000,
    purpose: "pigclaude-login",
    mode: "login",
  }
}

describe("AuthorizationService Rust adapter", () => {
  it("uses the Rust start response and exchanges the callback through the injected API", async () => {
    const vault = new MemoryVault()
    const calls: string[] = []
    let completedToken: AuthorizationToken | undefined
    const service = new AuthorizationService({
      authOrigin: "http://127.0.0.1:8788",
      vault,
      now: () => 1_000,
      deviceIdentity: {
        read: async () => ({ deviceId: "pcd_" + "1".repeat(64), platform: "darwin" }),
      },
      startAuthorization: async (input) => {
        expect(input).toMatchObject({
          scopes: ["user:read", "membership:read", "device:inspect", "device:revoke"],
        })
        calls.push(`start:${input.deviceId}:${input.codeChallenge}`)
        return {
          contextId: "context-1",
          authorizationUrl: `http://127.0.0.1:8788/authorize/flow-1/approve?state=${input.state}`,
          expiresAt: new Date(601_000).toISOString(),
        }
      },
      exchangeCode: async (input) => {
        calls.push(`exchange:${input.code}:${input.session.sessionId}`)
        return token()
      },
      onCompleted: async ({ token: exchanged }) => {
        completedToken = exchanged
      },
    })

    const started = await service.start(
      { ...loginRequest, mode: "register" },
      "http://127.0.0.1:43123/oauth/callback",
    )
    const state = new URL(started.authorizationUrl).searchParams.get("state")
    const result = await service.handleCallback(
      `http://127.0.0.1:43123/oauth/callback?code=one-time-code&state=${state}`,
    )

    expect(result).toMatchObject({ status: "completed", accountId: "user-1" })
    expect(calls[0]).toMatch(/^start:/)
    expect(calls[1]).toMatch(/^exchange:one-time-code:/)
    expect(completedToken?.accountId).toBe("user-1")
    expect(await vault.get("authorization:pigclaude-login:user-1")).toContain("refresh-secret")
  })
})
