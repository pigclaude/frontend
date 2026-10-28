// 负责验证会员开链固定可信站点、仅传短期办理目标，并绑定当前逻辑会话。
import { expect, it, vi } from "vitest"
import { createDesktopComposition } from "../composition"
import { oauthSessionFixture, profileApi, ProfileVault, deferred } from "../testing/profile-fixture"
import { PigclaudeApiError } from "../api/oauth-client"

const original = oauthSessionFixture()
it("opens only the configured website recovery entry without native credentials in the link", async () => {
  const vault = new ProfileVault()
  await vault.set("membership:session", JSON.stringify(original))
  const openWebsite = vi.fn<(url: string) => Promise<void>>(async () => undefined)
  const createMembershipTarget = vi.fn(async () => ({
    targetId: "00000000-0000-4000-8000-000000000001",
    action: "renew" as const,
    expiresAt: "2030-01-01T00:00:00Z",
  }))
  const composition = createDesktopComposition({
    vault,
    authOrigin: "https://login.example.test",
    websiteOrigin: "https://members.example.test",
    openWebsite,
    api: profileApi({
      createMembershipTarget,
      readRecovery: async () => ({
        userId: original.userId,
        deviceId: original.deviceId,
        bindingEpoch: original.bindingEpoch,
        authVersion: original.authVersion,
        account: { userId: original.userId, nickname: "", email: "a@example.test", avatar: "" },
        membership: { status: "expired", tier: null, validUntil: "2026-01-01T00:00:00Z" },
        grantExpiresAt: "2030-01-01T00:00:00Z",
        canRevoke: true,
      }),
    }),
  })
  try {
    const view = await composition.resume()
    const context = view.actionContextId
    expect(context).toEqual(expect.any(String))
    await composition.openMembershipWebsite(context ?? "")
    expect(openWebsite).toHaveBeenCalledWith(
      "https://members.example.test/membership/recovery?target=00000000-0000-4000-8000-000000000001",
    )
    expect(createMembershipTarget).toHaveBeenCalledWith(original.accessToken)
    const link = openWebsite.mock.calls[0]?.[0]
    expect(link).not.toContain(original.accessToken)
    expect(link).not.toContain(original.refreshToken)
  } finally {
    await composition.dispose()
  }
})

async function websiteCase() {
  const vault = new ProfileVault()
  await vault.set("membership:session", JSON.stringify(original))
  const opened = vi.fn<(url: string) => Promise<void>>(async () => undefined)
  const entered = deferred<void>()
  const response = deferred<{ targetId: string; action: "renew"; expiresAt: string }>()
  const create = vi.fn(async () => {
    entered.resolve(undefined)
    return response.promise
  })
  const composition = createDesktopComposition({
    vault,
    authOrigin: "https://login.example.test",
    openWebsite: opened,
    api: profileApi({
      createMembershipTarget: create,
      refreshToken: async () => ({
        access_token: "rotated-access",
        refresh_token: "rotated-refresh",
        token_type: "Bearer",
        expires_in: 3600,
        scope: original.scope,
      }),
      readRecovery: async () => ({
        userId: original.userId,
        deviceId: original.deviceId,
        bindingEpoch: original.bindingEpoch,
        authVersion: original.authVersion,
        account: { userId: original.userId, nickname: "", email: "a@example.test", avatar: "" },
        membership: { status: "expired", tier: null, validUntil: "2026-01-01T00:00:00Z" },
        grantExpiresAt: "2030-01-01T00:00:00Z",
        canRevoke: true,
      }),
    }),
  })
  const context = (await composition.resume()).actionContextId ?? ""
  return { composition, context, opened, create, entered, response }
}
const target = {
  targetId: "00000000-0000-4000-8000-000000000001",
  action: "renew" as const,
  expiresAt: "2030-01-01T00:00:00Z",
}

it("does not let a stale displayed account open a target for a newer session", async () => {
  const f = await websiteCase()
  try {
    await f.composition.membershipGate.acceptAuthorization({
      ...original,
      userId: "new-user",
      accessToken: "new-access",
      refreshToken: "new-refresh",
    })
    await expect(f.composition.openMembershipWebsite(f.context)).rejects.toThrow(
      "RECOVERY_CONTEXT_CHANGED",
    )
    expect(f.create).not.toHaveBeenCalled()
    expect(f.opened).not.toHaveBeenCalled()
  } finally {
    await f.composition.dispose()
  }
})

it("drops late website navigation after sign-out", async () => {
  const f = await websiteCase()
  const opening = f.composition.openMembershipWebsite(f.context).catch((error: unknown) => error)
  try {
    await f.entered.promise
    await f.composition.signOut()
    f.response.resolve(target)
    await opening
    expect(f.opened).not.toHaveBeenCalled()
    expect(await f.composition.tokenManager.snapshot()).toBeNull()
  } finally {
    f.response.resolve(target)
    await opening
    await f.composition.dispose()
  }
})

it("keeps a navigation context across a legal same-family refresh", async () => {
  const f = await websiteCase()
  const opening = f.composition.openMembershipWebsite(f.context)
  try {
    await f.entered.promise
    let first = true
    await f.composition.tokenManager.run(async () => {
      if (first) {
        first = false
        throw new PigclaudeApiError("invalid_token", 401)
      }
    })
    f.response.resolve(target)
    await opening
    expect(f.opened).toHaveBeenCalledTimes(1)
  } finally {
    f.response.resolve(target)
    await opening
    await f.composition.dispose()
  }
})
