// 负责验证独立 Claude adapter 的真实 composition 接线，不触及第一方 grant 或会员。
import { expect, it } from "vitest"
import { createDesktopComposition } from "./composition"
import { profileApi, ProfileVault } from "./testing/profile-fixture"

it("routes an injected Claude adapter exclusively to its own vault namespace", async () => {
  const vault = new ProfileVault()
  let network = 0
  const composition = createDesktopComposition({
    vault,
    authOrigin: "http://127.0.0.1:8788",
    api: profileApi({
      prepareDeviceAuthorization: async () => {
        network++
        throw new Error("first-party grant must not receive Claude")
      },
      inspectMembership: async () => {
        network++
        throw new Error("Claude must not enter gate")
      },
    }),
    claudeAuthorization: {
      start: async (session) => ({
        authorizationUrl: `https://claude-provider.test/authorize?state=${session.state}`,
        expiresAt: Date.now() + 600_000,
      }),
      exchangeCode: async (input) => {
        expect(input.code).toBe("claude-code")
        expect(input.codeVerifier.length).toBe(64)
        return {
          purpose: "claude-account",
          mode: "authorize",
          accountId: "pool",
          displayName: "Claude",
          credential: "isolated-claude-credential",
          expiresAt: Date.now() + 300_000,
        }
      },
    },
  })
  await composition.authorizationService.start(
    { purpose: "claude-account", mode: "authorize", bridgeExit: "exit", daemonExit: "exit" },
    "pigclaude://authorize/callback",
  )
  const state = composition.authorizationService.getActiveSession()?.state
  expect(
    await composition.authorizationService.handleCallback(
      `pigclaude://authorize/callback?code=claude-code&state=${state}`,
    ),
  ).toMatchObject({ status: "completed", purpose: "claude-account" })
  expect(network).toBe(0)
  expect(await vault.get("membership:session")).toBeNull()
  const saved = await vault.get("authorization:claude-account:pool")
  expect(saved).toContain("isolated-claude-credential")
  await composition.signOut()
  expect(await vault.get("authorization:claude-account:pool")).toBe(saved)
  await composition.dispose()
})
