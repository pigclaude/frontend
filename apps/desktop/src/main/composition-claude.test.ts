// 负责验证独立 Claude adapter 的真实 composition 接线，不触及第一方 grant 或会员。

import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it, vi } from "vitest"
import { LocalStore } from "@pigclaude/local-store"
import { createDesktopComposition } from "./composition"
import { profileApi, ProfileVault, seedProfile, membershipView } from "./testing/profile-fixture"

it("routes an injected Claude adapter exclusively to its own vault namespace", async () => {
  const dir = await mkdtemp(join(tmpdir(), "composition-claude-"))
  const vault = new ProfileVault()
  await seedProfile(vault)
  let network = 0
  let checks = 0
  const composition = createDesktopComposition({
    vault,
    authOrigin: "http://127.0.0.1:8788",
    localStore: new LocalStore(dir),
    api: profileApi({
      prepareDeviceAuthorization: async () => {
        network++
        throw new Error("first-party grant must not receive Claude")
      },
      inspectMembership: async () => {
        checks++
        return membershipView()
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
  try {
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
    expect(checks).toBe(2)
    expect(await vault.get("membership:session")).toContain("new-fixture-refresh")
    const saved = await vault.get("authorization:claude-account:pool")
    expect(saved).toContain("isolated-claude-credential")

    expect(composition.runtime).not.toBeNull()
    await vi.waitFor(() =>
      expect(composition.runtime?.daemonBaseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/),
    )
    await composition.signOut()
    expect(await vault.get("authorization:claude-account:pool")).toBe(saved)
  } finally {
    await composition.dispose()
    await rm(dir, { recursive: true, force: true })
  }
  expect(composition.runtime?.daemonBaseUrl).toBeNull()
})
