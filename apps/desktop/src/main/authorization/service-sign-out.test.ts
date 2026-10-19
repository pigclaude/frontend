// 负责验证授权暂停隔离交换、已进入安全仓库的写入及开始请求的迟到完成。
import { describe, expect, it } from "vitest"
import { AuthorizationService } from "./service"
import { deferred, ProfileVault } from "../testing/profile-fixture"
import type { AuthorizationToken } from "./types"

const request = { purpose: "pigclaude-login", mode: "login" } as const
const redirect = "http://127.0.0.1:43123/oauth/callback"
const token: AuthorizationToken = {
  ...request,
  accountId: "fixture-user",
  displayName: "fixture",
  expiresAt: 601_000,
  accessToken: "fixture-access",
  refreshToken: "fixture-refresh",
}

describe("AuthorizationService local sign-out isolation", () => {
  it("drains a token write already in progress and never completes the invalidated session", async () => {
    const vault = new ProfileVault()
    const entered = deferred<void>()
    const release = deferred<void>()
    vault.beforeSet = async () => {
      entered.resolve(undefined)
      await release.promise
    }
    let completions = 0
    const service = new AuthorizationService({
      authOrigin: "http://127.0.0.1:8788",
      vault,
      now: () => 1_000,
      exchangeCode: async () => token,
      onCompleted: async () => {
        completions++
      },
    })
    await service.start(request, redirect)
    const state = service.getActiveSession()?.state
    const callback = service.handleCallback(`${redirect}?code=old&state=${state}`)
    await entered.promise
    const drained = service.suspend()
    let cleared = false
    const cleanup = drained.then(async () => {
      await vault.deletePrefix("authorization:")
      cleared = true
    })
    await Promise.resolve()
    expect(cleared).toBe(false)
    release.resolve(undefined)
    await cleanup

    expect(await callback).toMatchObject({ status: "cancelled" })
    expect(await vault.get("authorization:pigclaude-login:fixture-user")).toBeNull()
    expect(completions).toBe(0)
    service.resume()
    await service.start(request, redirect)
    const freshState = service.getActiveSession()?.state
    expect(
      await service.handleCallback(`${redirect}?code=fresh&state=${freshState}`),
    ).toMatchObject({ status: "completed" })
    expect(await vault.get("authorization:pigclaude-login:fixture-user")).toContain(
      "fixture-refresh",
    )
  })

  it("cancels an exchanging session so a late token cannot reach the vault", async () => {
    const vault = new ProfileVault()
    const entered = deferred<void>()
    const response = deferred<AuthorizationToken>()
    const service = new AuthorizationService({
      authOrigin: "http://127.0.0.1:8788",
      vault,
      now: () => 1_000,
      exchangeCode: async () => {
        entered.resolve(undefined)
        return response.promise
      },
    })
    const started = await service.start(request, redirect)
    const state = service.getActiveSession()?.state
    const callback = service.handleCallback(`${redirect}?code=old&state=${state}`)
    await entered.promise
    await service.cancel(started.sessionId)
    response.resolve(token)

    expect(await callback).toMatchObject({ status: "cancelled" })
    expect(vault.values.size).toBe(0)
  })

  it("never replaces a fresh callback session when an older start response arrives", async () => {
    const vault = new ProfileVault()
    const entered = deferred<void>()
    const release = deferred<void>()
    let starts = 0
    const service = new AuthorizationService({
      authOrigin: "http://127.0.0.1:8788",
      vault,
      now: () => 1_000,
      exchangeCode: async () => token,
      startAuthorization: async (input) => {
        const number = ++starts
        if (number === 1) {
          entered.resolve(undefined)
          await release.promise
        }
        return {
          flowId: `flow-${number}`,
          authorizationUrl: `http://127.0.0.1:8788/authorize/flow-${number}?state=${input.state}`,
          expiresAt: 601_000,
        }
      },
    })
    const old = service.start(request, redirect).catch((error: unknown) => error)
    await entered.promise
    await service.suspend()
    service.resume()
    const fresh = await service.start(request, redirect)
    release.resolve(undefined)

    expect(await old).toMatchObject({ status: "cancelled" })
    expect(service.getActiveSession()?.sessionId).toBe(fresh.sessionId)
  })
})
