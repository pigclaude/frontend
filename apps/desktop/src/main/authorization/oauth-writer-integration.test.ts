// 负责证明真实 code 完成与刷新使用同一写入归属，并保留明确的仓库失败状态。
import { expect, it } from "vitest"
import { createDesktopComposition } from "../composition"
import {
  deferred,
  oauthSessionFixture,
  profileApi,
  ProfileVault,
  seedProfile,
} from "../testing/profile-fixture"
import type { NativeOAuthToken } from "../api/oauth-client"
import { parseOAuthDesktopSession } from "./oauth-session"

const redirect = "http://127.0.0.1:43123/oauth/callback"
const request = { purpose: "pigclaude-login", mode: "login" } as const
const options = {
  authOrigin: "http://127.0.0.1:8788",
  now: () => 2_000,
  deviceIdentity: {
    read: async () => ({ deviceId: oauthSessionFixture().deviceId, platform: "darwin" as const }),
  },
}
const token = (): NativeOAuthToken => ({
  access_token: "late-access",
  refresh_token: "late-refresh",
  token_type: "Bearer",
  expires_in: 300,
  scope: oauthSessionFixture().scope,
})

it("real code completion supersedes an old refresh before its response can write", async () => {
  const vault = new ProfileVault()
  await seedProfile(vault)
  await vault.set(
    "membership:session",
    JSON.stringify({ ...oauthSessionFixture(), accessTokenExpiresAt: 1_000 }),
  )
  const entered = deferred<void>()
  const response = deferred<NativeOAuthToken>()
  const composition = createDesktopComposition({
    ...options,
    vault,
    api: profileApi({
      refreshToken: async () => {
        entered.resolve(undefined)
        return response.promise
      },
    }),
  })
  const refreshing = composition.tokenManager.accessToken().catch((error: unknown) => error)
  await entered.promise
  await composition.authorizationService.start(request, redirect)
  const state = composition.authorizationService.getActiveSession()?.state
  expect(
    await composition.authorizationService.handleCallback(
      `${redirect}?code=fixture&state=${state}`,
    ),
  ).toMatchObject({ status: "completed" })
  response.resolve(token())
  expect(await refreshing).toMatchObject({ code: "AUTHORIZATION_CANCELLED" })
  expect(await vault.get("membership:session")).toContain("new-fixture-refresh")
  expect(composition.membershipGate.view().state).toBe("active")
  await composition.dispose()
})

it("a late real code exchange cannot overwrite a newer explicitly adopted grant", async () => {
  const vault = new ProfileVault()
  const entered = deferred<void>()
  const response = deferred<NativeOAuthToken>()
  const composition = createDesktopComposition({
    ...options,
    vault,
    api: profileApi({
      exchangeCode: async () => {
        entered.resolve(undefined)
        return response.promise
      },
    }),
  })
  await composition.authorizationService.start(request, redirect)
  const state = composition.authorizationService.getActiveSession()?.state
  const code = composition.authorizationService.handleCallback(
    `${redirect}?code=fixture&state=${state}`,
  )
  await entered.promise
  await composition.membershipGate.acceptAuthorization(oauthSessionFixture())
  await composition.membershipGate.inspect()
  response.resolve(token())
  expect((await code).status).not.toBe("completed")
  expect(await vault.get("membership:session")).toContain("new-fixture-refresh")
  expect(composition.membershipGate.view().state).toBe("active")
  await composition.dispose()
})

it("code storage failure is explicit and never emits completed", async () => {
  const vault = new ProfileVault()
  vault.beforeSet = async () => {
    throw new Error("private disk details")
  }
  const composition = createDesktopComposition({ ...options, vault, api: profileApi() })
  await composition.authorizationService.start(request, redirect)
  const state = composition.authorizationService.getActiveSession()?.state
  const result = await composition.authorizationService.handleCallback(
    `${redirect}?code=fixture&state=${state}`,
  )
  expect(result).toMatchObject({ status: "exchange-error" })
  expect(result.error).toContain("SAFE_STORAGE_UNAVAILABLE")
  expect(result.error).not.toContain("private disk")
  expect(await vault.get("membership:session")).toBeNull()
  await composition.dispose()
})

it("current session schema requires durable original scope, without importing older records", () => {
  const older: Record<string, unknown> = { ...oauthSessionFixture() }
  delete older.grantedScope
  expect(parseOAuthDesktopSession(JSON.stringify(older))).toBeNull()
  expect(
    parseOAuthDesktopSession(
      JSON.stringify({
        ...oauthSessionFixture(),
        grantedScope: "user:read",
        scope: "user:read device:revoke",
      }),
    ),
  ).toBeNull()
})
