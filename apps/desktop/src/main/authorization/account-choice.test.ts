// 验证显式切换保留原登录，并在标准上下文校验后向浏览器要求账号确认。
import { expect, it } from "vitest"
import { readAuthorizationRequest } from "./request-input"
import { createDesktopComposition } from "../composition"
import { oauthSessionFixture, profileApi, ProfileVault } from "../testing/profile-fixture"
it("keeps an explicit switch intent separate from login and Claude authorization", () => {
  expect(readAuthorizationRequest({ purpose: "pigclaude-login", mode: "switch" })).toMatchObject({
    mode: "switch",
  })
  expect(readAuthorizationRequest({ purpose: "claude-account", mode: "switch" })).toBeNull()
})
it("opens an explicit account confirmation without clearing the current native login", async () => {
  const original = oauthSessionFixture()
  const vault = new ProfileVault()
  await vault.set("membership:session", JSON.stringify(original))
  const composition = createDesktopComposition({
    vault,
    authOrigin: "https://auth.example.test",
    deviceIdentity: {
      read: async () => ({ deviceId: original.deviceId, platform: "darwin" as const }),
    },
    api: profileApi({
      prepareDeviceAuthorization: async (input) => ({
        contextId: "fixture-context",
        authorizationUrl: `https://auth.example.test/oauth2/authorize?state=${input.state}&device_context=fixture-context`,
        expiresAt: "2030-01-01T00:00:00Z",
      }),
    }),
  })
  try {
    const request = readAuthorizationRequest({ purpose: "pigclaude-login", mode: "switch" })
    if (!request) throw new Error("switch request rejected")
    const started = await composition.authorizationService.start(
      request,
      "http://127.0.0.1:43123/oauth/callback",
    )
    const url = new URL(started.authorizationUrl)
    expect(url.searchParams.get("prompt")).toBe("consent")
    expect(url.searchParams.get("device_context")).toBe("fixture-context")
    expect((await composition.tokenManager.snapshot())?.record).toEqual(original)
    await composition.authorizationService.cancel(started.sessionId)
    expect((await composition.tokenManager.snapshot())?.record).toEqual(original)
  } finally {
    await composition.dispose()
  }
})
