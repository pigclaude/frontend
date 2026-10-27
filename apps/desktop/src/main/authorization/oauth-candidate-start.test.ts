// 负责验证 renderer 的准备阶段取消能失效真实候选请求，迟到 context 不能打开可提交的授权。
import { expect, it } from "vitest"
import { createDesktopComposition } from "../composition"
import { readAuthorizationRequest } from "./request-input"
import {
  deferred,
  oauthSessionFixture,
  profileApi,
  ProfileVault,
  seedProfile,
} from "../testing/profile-fixture"

it("cancels the exact preparing request and leaves its original committed login intact", async () => {
  const vault = new ProfileVault()
  await seedProfile(vault)
  const entered = deferred<void>()
  const release = deferred<void>()
  let oldState = ""
  let starts = 0
  const composition = createDesktopComposition({
    vault,
    authOrigin: "http://127.0.0.1:8788",
    now: () => 2_000,
    deviceIdentity: {
      read: async () => ({ deviceId: oauthSessionFixture().deviceId, platform: "darwin" as const }),
    },
    api: profileApi({
      prepareDeviceAuthorization: async (input) => {
        if (++starts === 1) {
          oldState = input.state
          entered.resolve(undefined)
          await release.promise
        }
        return {
          contextId: "fixture",
          authorizationUrl: `http://127.0.0.1:8788/oauth2/authorize?state=${input.state}`,
          expiresAt: new Date(600_000).toISOString(),
        }
      },
    }),
  })
  try {
    await composition.membershipGate.inspect()
    const request = readAuthorizationRequest({
      purpose: "pigclaude-login",
      mode: "login",
      clientRequestId: "preparing-attempt",
    })
    if (!request) throw new Error("fixture request rejected")
    const preparing = composition.authorizationService
      .start(request, "http://127.0.0.1:43123/oauth/callback")
      .catch((error: unknown) => error)
    await entered.promise
    expect(await composition.authorizationService.cancel("preparing-attempt")).toMatchObject({
      status: "cancelled",
      sessionId: expect.not.stringMatching(/^$/),
    })
    release.resolve(undefined)
    expect(await preparing).toMatchObject({ status: "cancelled" })
    expect(
      await composition.authorizationService.handleCallback(
        `http://127.0.0.1:43123/oauth/callback?code=late&state=${oldState}`,
      ),
    ).toMatchObject({ status: "state-mismatch" })
    expect((await composition.tokenManager.snapshot())?.record).toEqual(oauthSessionFixture())
    const fresh = await composition.authorizationService.start(
      { ...request, clientRequestId: "fresh-attempt" },
      "http://127.0.0.1:43123/oauth/callback",
    )
    await composition.authorizationService.cancel("preparing-attempt")
    expect(composition.authorizationService.getActiveSession()?.sessionId).toBe(fresh.sessionId)
  } finally {
    release.resolve(undefined)
    await composition.dispose()
  }
})
