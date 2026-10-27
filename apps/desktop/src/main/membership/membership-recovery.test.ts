// 负责通过真实桌面组合服务验证恢复事实、业务权限与账号归属分别处理。
import { expect, it, vi } from "vitest"
import type { DesktopRecoverySnapshot } from "@pigclaude/contracts/desktop-membership"
import { createDesktopComposition } from "../composition"
import { oauthSessionFixture, profileApi, ProfileVault, deferred } from "../testing/profile-fixture"
import { PigclaudeApiError } from "../api/oauth-client"

const original = oauthSessionFixture()
const facts: DesktopRecoverySnapshot = {
  userId: original.userId,
  deviceId: original.deviceId,
  bindingEpoch: original.bindingEpoch,
  authVersion: original.authVersion,
  account: {
    userId: original.userId,
    nickname: "阿青",
    email: "recovery@example.test",
    avatar: "",
  },
  membership: {
    status: "expired",
    tier: { code: "vip", name: "VIP", level: 1 },
    validUntil: "2026-01-01T00:00:00Z",
  },
  grantExpiresAt: "2030-01-01T00:00:00Z",
  canRevoke: true,
}
it("explains verified membership expiry with identity-only access without granting business use", async () => {
  const vault = new ProfileVault()
  await vault.set(
    "membership:session",
    JSON.stringify({ ...original, scope: "user:read device:revoke" }),
  )
  const inspectMembership = vi.fn(async () => {
    throw new Error("business must not be called")
  })
  const composition = createDesktopComposition({
    vault,
    authOrigin: "https://auth.example.test",
    now: () => Date.parse("2026-10-28T00:00:00Z"),
    api: profileApi({ readRecovery: async () => facts, inspectMembership }),
  })
  try {
    expect(await composition.resume()).toMatchObject({
      state: "expired",
      account: { nickname: "阿青", email: "recovery@example.test" },
      recovery: { status: "expired", canRevoke: true },
    })
    await expect(composition.runAuthorized(async () => "forbidden")).rejects.toThrow(
      "MEMBERSHIP_REQUIRED",
    )
    expect(inspectMembership).not.toHaveBeenCalled()
  } finally {
    await composition.dispose()
  }
})

it.each(["AUTHORIZATION_EXPIRED", "insufficient_scope", "SERVER_UNAVAILABLE"])(
  "does not present %s as membership expiry",
  async (code) => {
    const vault = new ProfileVault()
    await vault.set("membership:session", JSON.stringify(original))
    const composition = createDesktopComposition({
      vault,
      authOrigin: "https://auth.example.test",
      api: profileApi({
        readRecovery: async () => {
          throw new PigclaudeApiError(code, 401)
        },
      }),
    })
    try {
      const view = await composition.resume()
      expect(view.state).not.toBe("expired")
      expect(view.recovery).toBeUndefined()
      expect(view.tier).toBeNull()
    } finally {
      await composition.dispose()
    }
  },
)

it("cannot publish an old recovery response over a newly committed account", async () => {
  const vault = new ProfileVault()
  await vault.set("membership:session", JSON.stringify(original))
  const entered = deferred<void>()
  const response = deferred<DesktopRecoverySnapshot>()
  const composition = createDesktopComposition({
    vault,
    authOrigin: "https://auth.example.test",
    api: profileApi({
      readRecovery: async (token) => {
        if (token === original.accessToken) {
          entered.resolve(undefined)
          return response.promise
        }
        return {
          ...facts,
          userId: "user-b",
          account: { userId: "user-b", nickname: "乙", email: "b@example.test", avatar: "" },
          membership: { status: "none", tier: null, validUntil: null },
        }
      },
    }),
  })
  try {
    const pending = composition.resume()
    await entered.promise
    await composition.membershipGate.acceptAuthorization({
      ...original,
      userId: "user-b",
      accessToken: "access-b",
      refreshToken: "refresh-b",
    })
    await composition.resume()
    response.resolve(facts)
    expect(await pending).toMatchObject({
      account: { userId: "user-b", nickname: "乙" },
      recovery: { status: "none" },
    })
    expect(composition.membershipGate.view().state).not.toBe("expired")
  } finally {
    response.resolve(facts)
    await composition.dispose()
  }
})
