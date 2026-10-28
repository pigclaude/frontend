// 验证旧回调、无关地址与迟到兑换不能冒充新候选流程的进度或失败。
import { expect, it } from "vitest"
import { createDesktopComposition } from "../composition"
import type { AuthorizationStateEvent } from "./types"
import {
  deferred,
  oauthSessionFixture,
  profileApi,
  ProfileVault,
  seedProfile,
} from "../testing/profile-fixture"
import type { NativeOAuthToken } from "../api/oauth-client"
const redirect = "http://127.0.0.1:43123/oauth/callback"
const request = { purpose: "pigclaude-login", mode: "switch" } as const
const token: NativeOAuthToken = {
  access_token: "candidate-access",
  refresh_token: "candidate-refresh",
  token_type: "Bearer",
  expires_in: 300,
  scope: oauthSessionFixture().scope,
}
async function setup(exchangeCode: () => Promise<NativeOAuthToken> = async () => token) {
  const vault = new ProfileVault()
  await seedProfile(vault)
  const events: AuthorizationStateEvent[] = []
  const composition = createDesktopComposition({
    vault,
    authOrigin: "http://127.0.0.1:8788",
    now: () => 2000,
    deviceIdentity: {
      read: async () => ({ deviceId: oauthSessionFixture().deviceId, platform: "darwin" as const }),
    },
    api: profileApi({ exchangeCode }),
    onAuthorizationState: (event) => events.push(event),
  })
  return { composition, events }
}
it("keeps a newer waiting session untouched by old or unrelated callbacks", async () => {
  const { composition, events } = await setup()
  try {
    const old = await composition.authorizationService.start(request, redirect)
    const oldState = new URL(old.authorizationUrl).searchParams.get("state")
    await composition.authorizationService.cancel(old.sessionId)
    const fresh = await composition.authorizationService.start(request, redirect)
    const state = new URL(fresh.authorizationUrl).searchParams.get("state")
    for (const url of [
      `${redirect}?error=access_denied&state=${oldState}`,
      `${redirect}?code=old&state=${oldState}`,
      `http://127.0.0.1:43124/oauth/callback?code=wrong&state=${state}`,
      "not-a-url",
    ]) {
      expect(await composition.authorizationService.handleCallback(url)).toMatchObject({
        sessionId: "",
        status: "state-mismatch",
      })
      expect(composition.authorizationService.getActiveSession()?.sessionId).toBe(fresh.sessionId)
      expect(events).toEqual([])
    }
    expect(
      await composition.authorizationService.handleCallback(
        `${redirect}?code=fresh&state=${state}`,
      ),
    ).toMatchObject({ sessionId: fresh.sessionId, status: "completed" })
    expect(events.map((event) => ({ sessionId: event.sessionId, status: event.status }))).toEqual([
      { sessionId: fresh.sessionId, status: "exchanging" },
      { sessionId: fresh.sessionId, status: "committing" },
    ])
  } finally {
    await composition.dispose()
  }
})
it("does not associate late exchange completion with a newer waiting session", async () => {
  const entered = deferred<void>(),
    response = deferred<NativeOAuthToken>()
  let exchanges = 0
  const { composition, events } = await setup(async () => {
    if (++exchanges === 1) {
      entered.resolve(undefined)
      return response.promise
    }
    return token
  })
  try {
    const old = await composition.authorizationService.start(request, redirect)
    const oldState = new URL(old.authorizationUrl).searchParams.get("state")
    const completing = composition.authorizationService.handleCallback(
      `${redirect}?code=old&state=${oldState}`,
    )
    await entered.promise
    await composition.authorizationService.cancel(old.sessionId)
    const fresh = await composition.authorizationService.start(request, redirect)
    const count = events.length
    response.resolve(token)
    expect(await completing).toMatchObject({ sessionId: "", status: "cancelled" })
    expect(events.slice(count)).toEqual([])
    expect(composition.authorizationService.getActiveSession()?.sessionId).toBe(fresh.sessionId)
    const state = new URL(fresh.authorizationUrl).searchParams.get("state")
    expect(
      await composition.authorizationService.handleCallback(
        `${redirect}?code=fresh&state=${state}`,
      ),
    ).toMatchObject({ sessionId: fresh.sessionId, status: "completed" })
  } finally {
    response.resolve(token)
    await composition.dispose()
  }
})
