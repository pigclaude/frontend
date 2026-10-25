// 负责验证主进程授权服务的会话、出口门禁、回调和秘密边界。
import { describe, expect, it } from "vitest"
import {
  AuthorizationStartError,
  AuthorizationService,
  type AuthorizationExchange,
} from "./service"
import type { AuthorizationRequest, AuthorizationToken } from "./types"
import type { DeviceAuthorizationInput } from "../api/oauth-client"
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

const loginRequest: AuthorizationRequest = {
  purpose: "pigclaude-login",
  mode: "login",
}

const accountRequest: AuthorizationRequest = {
  purpose: "claude-account",
  mode: "authorize",
  accountName: "主力 Max",
  proxyId: "la-01",
  fingerprintSeed: "fp_seed",
  bridgeExit: "203.0.113.42",
  daemonExit: "203.0.113.42",
}

function tokenFor(request: AuthorizationRequest): AuthorizationToken {
  return {
    accessToken: "access-secret",
    refreshToken: "refresh-secret",
    credential: "credential-secret",
    accountId: "account-1",
    displayName: request.accountName ?? "林舟",
    expiresAt: 2_000_000,
    purpose: request.purpose,
    mode: request.mode,
  }
}

describe("AuthorizationService", () => {
  it("does not create a Claude authorization URL when exits differ", async () => {
    const vault = new MemoryVault()
    const service = new AuthorizationService({
      authOrigin: "http://localhost:5173",
      vault,
      exchangeCode: async () => tokenFor(accountRequest),
      now: () => 1_000,
    })

    await expect(
      service.start(
        { ...accountRequest, daemonExit: "198.51.100.17" },
        "http://127.0.0.1:43123/oauth/callback",
      ),
    ).rejects.toMatchObject({ status: "proxy-mismatch" } satisfies Pick<
      AuthorizationStartError,
      "status"
    >)
  })

  it("exchanges a valid callback, stores secrets, and emits only metadata", async () => {
    const vault = new MemoryVault()
    let exchangeInput: AuthorizationExchange | undefined
    const service = new AuthorizationService({
      authOrigin: "http://localhost:5173",
      vault,
      exchangeCode: async (input) => {
        exchangeInput = input
        return tokenFor(input.session.request)
      },
      now: () => 1_000,
    })
    const started = await service.start(loginRequest, "http://127.0.0.1:43123/oauth/callback")
    const callback = new URL(started.authorizationUrl)
    const result = await service.handleCallback(
      `http://127.0.0.1:43123/oauth/callback?code=one-time-code&state=${callback.searchParams.get("state")}`,
    )

    expect(result).toMatchObject({ status: "completed", accountId: "account-1" })
    expect(result).not.toHaveProperty("accessToken")
    expect(result).not.toHaveProperty("refreshToken")
    expect(result).not.toHaveProperty("credential")
    expect(exchangeInput?.code).toBe("one-time-code")
    expect(await vault.get("authorization:pigclaude-login:account-1")).toContain("refresh-secret")
    expect(service.getActiveSession()).toBeNull()
  })

  it("sends the computer name, os and app version in the authorization context", async () => {
    const vault = new MemoryVault()
    let sent: DeviceAuthorizationInput | undefined
    const service = new AuthorizationService({
      authOrigin: "http://localhost:5173",
      vault,
      exchangeCode: async () => tokenFor(loginRequest),
      deviceIdentity: {
        read: async () => ({ deviceId: "pcd_" + "1".repeat(64), platform: "darwin" }),
      },
      deviceInfo: async () => ({
        name: "Lin 的 MacBook Pro",
        osVersion: "macOS 15.4",
        appVersion: "1.3.0",
      }),
      startAuthorization: async (input) => {
        sent = input
        return {
          contextId: "context",
          authorizationUrl: "http://localhost:5173/oauth2/authorize?state=state",
          expiresAt: new Date(2_000_000).toISOString(),
        }
      },
      now: () => 1_000,
    })

    await service.start(loginRequest, "http://127.0.0.1:43123/oauth/callback")

    expect(sent).toMatchObject({
      deviceId: "pcd_" + "1".repeat(64),
      platform: "darwin",
      name: "Lin 的 MacBook Pro",
      osVersion: "macOS 15.4",
      appVersion: "1.3.0",
    })
    expect(JSON.stringify(sent)).not.toContain("Pigclaude Desktop")
  })

  it("rejects a mismatched state and never calls exchange", async () => {
    const vault = new MemoryVault()
    let exchanges = 0
    const service = new AuthorizationService({
      authOrigin: "http://localhost:5173",
      vault,
      exchangeCode: async () => {
        exchanges += 1
        return tokenFor(loginRequest)
      },
      now: () => 1_000,
    })
    const started = await service.start(loginRequest, "http://127.0.0.1:43123/oauth/callback")
    const result = await service.handleCallback(
      `http://127.0.0.1:43123/oauth/callback?code=code&state=wrong-state`,
    )

    expect(result).toMatchObject({ status: "state-mismatch" })
    expect(exchanges).toBe(0)
    expect(service.getActiveSession()?.sessionId).toBe(started.sessionId)
  })

  it("consumes the session before exchange so a failed code cannot be replayed", async () => {
    const vault = new MemoryVault()
    let exchanges = 0
    const service = new AuthorizationService({
      authOrigin: "http://localhost:5173",
      vault,
      exchangeCode: async () => {
        exchanges += 1
        throw new Error("token endpoint unavailable")
      },
      now: () => 1_000,
    })
    const started = await service.start(loginRequest, "http://127.0.0.1:43123/oauth/callback")
    const state = new URL(started.authorizationUrl).searchParams.get("state")
    const callback = `http://127.0.0.1:43123/oauth/callback?code=code&state=${state}`

    await expect(service.handleCallback(callback)).resolves.toMatchObject({
      status: "exchange-error",
    })
    await expect(service.handleCallback(callback)).resolves.toMatchObject({
      status: "state-mismatch",
    })
    expect(exchanges).toBe(1)
  })

  it("returns expired when the browser answers after the ten-minute window", async () => {
    const vault = new MemoryVault()
    let now = 1_000
    const service = new AuthorizationService({
      authOrigin: "http://localhost:5173",
      vault,
      exchangeCode: async () => tokenFor(loginRequest),
      now: () => now,
    })
    const started = await service.start(loginRequest, "http://127.0.0.1:43123/oauth/callback")
    const state = new URL(started.authorizationUrl).searchParams.get("state")
    now = 601_001

    await expect(
      service.handleCallback(`http://127.0.0.1:43123/oauth/callback?code=code&state=${state}`),
    ).resolves.toMatchObject({ status: "expired" })
  })
})
