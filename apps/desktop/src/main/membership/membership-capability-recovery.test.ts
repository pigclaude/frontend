// 负责验证已确认会员恢复后仅在原 grant 范围内受控轮换，再通过业务接口恢复使用。
import { expect, it, vi } from "vitest"
import type {
  DesktopRecoverySnapshot,
  MembershipInspectRequest,
} from "@pigclaude/contracts/desktop-membership"
import { createDesktopComposition } from "../composition"
import {
  membershipView,
  oauthSessionFixture,
  profileApi,
  ProfileVault,
  deferred,
} from "../testing/profile-fixture"
import type { PigclaudeApi } from "../api/pigclaude-api-client"
import type { NativeOAuthToken } from "../api/oauth-client"
import { PigclaudeApiError } from "../api/oauth-client"
import type { OAuthDesktopSession } from "@pigclaude/contracts/desktop-membership"

const original = oauthSessionFixture()
const facts: DesktopRecoverySnapshot = {
  userId: original.userId,
  deviceId: original.deviceId,
  bindingEpoch: original.bindingEpoch,
  authVersion: original.authVersion,
  account: { userId: original.userId, nickname: "恢复用户", email: "a@example.test", avatar: "" },
  membership: {
    status: "active",
    tier: { code: "vip", name: "VIP", level: 1 },
    validUntil: "2030-01-01T00:00:00Z",
  },
  grantExpiresAt: "2030-01-01T00:00:00Z",
  canRevoke: true,
}
it("restores a legally restricted token before allowing business use, preserving the grant ceiling and deadline", async () => {
  const vault = new ProfileVault()
  await vault.set(
    "membership:session",
    JSON.stringify({ ...original, scope: "user:read device:revoke" }),
  )
  const refreshToken = vi.fn(async () => ({
    access_token: "restored-access",
    refresh_token: "restored-refresh",
    token_type: "Bearer" as const,
    expires_in: 3600,
    scope: original.scope,
  }))
  const inspectMembership = vi.fn(
    async (_input: MembershipInspectRequest, accessToken?: string) => {
      expect(accessToken).toBe("restored-access")
      return membershipView()
    },
  )
  const composition = createDesktopComposition({
    vault,
    authOrigin: "https://auth.example.test",
    api: profileApi({ readRecovery: async () => facts, refreshToken, inspectMembership }),
  })
  try {
    expect(await composition.resume()).toMatchObject({
      state: "active",
      account: { userId: original.userId },
    })
    expect(refreshToken).toHaveBeenCalledTimes(1)
    expect((await composition.tokenManager.snapshot())?.record).toMatchObject({
      scope: original.scope,
      grantedScope: original.grantedScope,
      refreshTokenExpiresAt: original.refreshTokenExpiresAt,
    })
    expect(await composition.runAuthorized(async () => "allowed")).toBe("allowed")
    expect(refreshToken).toHaveBeenCalledTimes(1)
  } finally {
    await composition.dispose()
  }
})

const restored: NativeOAuthToken = {
  access_token: "restored-access",
  refresh_token: "restored-refresh",
  token_type: "Bearer",
  expires_in: 3600,
  scope: original.scope,
}
const now = Date.parse("2026-10-28T00:00:00Z")
async function restricted(
  overrides: Partial<PigclaudeApi> = {},
  record: Partial<OAuthDesktopSession> = {},
) {
  const vault = new ProfileVault()
  await vault.set(
    "membership:session",
    JSON.stringify({ ...original, scope: "user:read device:revoke", ...record }),
  )
  const api = profileApi({
    readRecovery: async () => facts,
    refreshToken: vi.fn(async () => restored),
    ...overrides,
  })
  const composition = createDesktopComposition({
    vault,
    authOrigin: "https://auth.example.test",
    now: () => now,
    api,
  })
  return { vault, api, composition }
}

it("coalesces necessary refresh across concurrent checks", async () => {
  const entered = deferred<void>()
  const response = deferred<NativeOAuthToken>()
  const refreshToken = vi.fn(async () => {
    entered.resolve(undefined)
    return response.promise
  })
  const { composition } = await restricted({ refreshToken })
  const checks = Array.from({ length: 10 }, () => composition.resume())
  try {
    await entered.promise
    expect(refreshToken).toHaveBeenCalledTimes(1)
    response.resolve(restored)
    await Promise.all(checks)
    expect(composition.membershipGate.view().state).toBe("active")
    expect(refreshToken).toHaveBeenCalledTimes(1)
  } finally {
    response.resolve(restored)
    await Promise.allSettled(checks)
    await composition.dispose()
  }
})

it("does not refresh an already capable token for ordinary business permission errors", async () => {
  const { composition, api } = await restricted(
    {
      inspectMembership: async () => {
        throw new PigclaudeApiError("insufficient_scope", 403)
      },
    },
    { scope: original.scope },
  )
  try {
    expect((await composition.resume()).state).toBe("verification_required")
    expect((await composition.resume()).state).toBe("verification_required")
    expect(api.refreshToken).not.toHaveBeenCalled()
  } finally {
    await composition.dispose()
  }
})

it.each(["original-scope", "absolute-expiry", "remote-expiry"])(
  "requires authorization without consuming refresh for %s",
  async (kind) => {
    const { composition, api } = await restricted(
      {
        readRecovery: async () =>
          kind === "remote-expiry"
            ? { ...facts, grantExpiresAt: new Date(now - 1).toISOString() }
            : facts,
      },
      kind === "original-scope"
        ? { grantedScope: "user:read device:revoke" }
        : kind === "absolute-expiry"
          ? { accessTokenExpiresAt: now - 10_000, refreshTokenExpiresAt: now - 1 }
          : {},
    )
    try {
      expect((await composition.resume()).state).toBe("verification_required")
      expect(api.refreshToken).not.toHaveBeenCalled()
    } finally {
      await composition.dispose()
    }
  },
)

it("cannot restore an old refresh result over a new committed account", async () => {
  const entered = deferred<void>()
  const response = deferred<NativeOAuthToken>()
  const { composition } = await restricted({
    refreshToken: async () => {
      entered.resolve(undefined)
      return response.promise
    },
  })
  const checking = composition.resume()
  try {
    await entered.promise
    await composition.membershipGate.acceptAuthorization({
      ...original,
      userId: "user-b",
      accessToken: "access-b",
      refreshToken: "refresh-b",
    })
    response.resolve(restored)
    await checking
    expect((await composition.tokenManager.snapshot())?.record).toMatchObject({
      userId: "user-b",
      refreshToken: "refresh-b",
    })
    expect(composition.membershipGate.view().account?.userId).toBe("user-b")
  } finally {
    response.resolve(restored)
    await checking
    await composition.dispose()
  }
})

it("explicit local sign-out wins without waiting for recovery HTTP", async () => {
  const entered = deferred<void>()
  const response = deferred<NativeOAuthToken>()
  const { composition } = await restricted({
    refreshToken: async () => {
      entered.resolve(undefined)
      return response.promise
    },
  })
  const checking = composition.resume()
  try {
    await entered.promise
    await composition.signOut()
    response.resolve(restored)
    await checking
    expect(await composition.tokenManager.snapshot()).toBeNull()
    expect(composition.membershipGate.view().state).toBe("signed_out")
  } finally {
    response.resolve(restored)
    await checking
    await composition.dispose()
  }
})

it.each(["invalid_grant", "invalid_scope"])(
  "requires reauthorization when recovery refresh returns %s",
  async (code) => {
    const refreshToken = vi.fn(async () => {
      throw new PigclaudeApiError(code, 400)
    })
    const { composition } = await restricted({ refreshToken })
    try {
      expect((await composition.resume()).state).toBe("verification_required")
      await composition.resume()
      expect(refreshToken).toHaveBeenCalledTimes(1)
      expect(await composition.tokenManager.snapshot()).toBeNull()
    } finally {
      await composition.dispose()
    }
  },
)

it("revalidates the restored token identity before granting business use", async () => {
  const inspectMembership = vi.fn(async () => membershipView())
  const { composition } = await restricted({
    inspectMembership,
    readDesktopSession: async () => ({
      userId: "different-user",
      deviceId: original.deviceId,
      bindingEpoch: original.bindingEpoch,
      authVersion: original.authVersion,
    }),
  })
  try {
    expect((await composition.resume()).state).toBe("device_revoked")
    expect(inspectMembership).not.toHaveBeenCalled()
  } finally {
    await composition.dispose()
  }
})

it("can retry when authoritative membership changes after an earlier recovery race", async () => {
  let version = "1"
  let refreshes = 0
  const refreshToken = vi.fn(async () => {
    refreshes++
    return refreshes === 1
      ? {
          ...restored,
          access_token: "limited-access",
          refresh_token: "limited-refresh",
          scope: "user:read device:revoke",
        }
      : restored
  })
  const { composition } = await restricted({
    refreshToken,
    readRecovery: async () => ({
      ...facts,
      membership: { ...facts.membership, entitlementVersion: version },
    }),
  })
  try {
    expect((await composition.resume()).state).toBe("verification_required")
    version = "2"
    expect((await composition.resume()).state).toBe("active")
    expect(refreshToken).toHaveBeenCalledTimes(2)
  } finally {
    await composition.dispose()
  }
})

it("does not charge a newer overlapping membership version with an older refresh failure", async () => {
  const firstFacts = deferred<DesktopRecoverySnapshot>()
  const secondFacts = deferred<DesktopRecoverySnapshot>()
  const bothReading = deferred<void>()
  const refreshing = deferred<void>()
  const firstResponse = deferred<NativeOAuthToken>()
  let reads = 0
  let refreshes = 0
  const refreshToken = vi.fn(async () => {
    if (++refreshes === 1) {
      refreshing.resolve(undefined)
      return firstResponse.promise
    }
    return restored
  })
  const { composition } = await restricted({
    refreshToken,
    readRecovery: async () => {
      if (++reads === 1) return firstFacts.promise
      bothReading.resolve(undefined)
      return secondFacts.promise
    },
  })
  const checks = [composition.resume(), composition.resume()]
  try {
    await bothReading.promise
    firstFacts.resolve({ ...facts, membership: { ...facts.membership, entitlementVersion: "1" } })
    await refreshing.promise
    secondFacts.resolve({ ...facts, membership: { ...facts.membership, entitlementVersion: "2" } })
    // 本轮 Promise 全部继续到等待中的 HTTP，第一个刷新响应仍由测试持有。
    await new Promise<void>((resolve) => setImmediate(resolve))
    firstResponse.resolve({
      ...restored,
      access_token: "limited-access",
      refresh_token: "limited-refresh",
      scope: "user:read device:revoke",
    })
    await Promise.all(checks)
    await composition.resume()
    expect(composition.membershipGate.view().state).toBe("active")
    expect(refreshToken).toHaveBeenCalledTimes(2)
  } finally {
    firstFacts.resolve(facts)
    secondFacts.resolve(facts)
    firstResponse.resolve(restored)
    await Promise.allSettled(checks)
    await composition.dispose()
  }
})

it("keeps a controlled opportunity after joining a prior ordinary refresh", async () => {
  const reading = deferred<void>()
  const recoveredFacts = deferred<DesktopRecoverySnapshot>()
  const refreshing = deferred<void>()
  const firstResponse = deferred<NativeOAuthToken>()
  let refreshes = 0
  const refreshToken = vi.fn(async () => {
    if (++refreshes === 1) {
      refreshing.resolve(undefined)
      return firstResponse.promise
    }
    return restored
  })
  const { composition } = await restricted({
    refreshToken,
    readRecovery: async () => {
      reading.resolve(undefined)
      return recoveredFacts.promise
    },
  })
  const checking = composition.resume()
  let ordinary: Promise<string> | undefined
  try {
    await reading.promise
    let operations = 0
    ordinary = composition.tokenManager.run(async ({ record }) => {
      if (++operations === 1) throw new PigclaudeApiError("invalid_token", 401)
      return record.accessToken
    })
    await refreshing.promise
    recoveredFacts.resolve(facts)
    await new Promise<void>((resolve) => setImmediate(resolve))
    firstResponse.resolve({
      ...restored,
      access_token: "limited-access",
      refresh_token: "limited-refresh",
      scope: "user:read device:revoke",
    })
    await Promise.all([checking, ordinary])
    expect(composition.membershipGate.view().state).toBe("active")
    expect(refreshToken).toHaveBeenCalledTimes(2)
  } finally {
    recoveredFacts.resolve(facts)
    firstResponse.resolve(restored)
    await Promise.allSettled([checking, ordinary])
    await composition.dispose()
  }
})

it("does not repeatedly refresh a family when the server still withholds business capabilities", async () => {
  const vault = new ProfileVault()
  await vault.set(
    "membership:session",
    JSON.stringify({ ...original, scope: "user:read device:revoke" }),
  )
  let calls = 0
  const refreshToken = vi.fn(async () => {
    calls++
    return {
      access_token: `limited-${calls}`,
      refresh_token: `limited-refresh-${calls}`,
      token_type: "Bearer" as const,
      expires_in: 300,
      scope: "user:read device:revoke",
    }
  })
  const composition = createDesktopComposition({
    vault,
    authOrigin: "https://auth.example.test",
    api: profileApi({ readRecovery: async () => facts, refreshToken }),
  })
  try {
    expect(await composition.resume()).toMatchObject({ state: "verification_required" })
    expect(await composition.resume()).toMatchObject({ state: "verification_required" })
    expect(refreshToken).toHaveBeenCalledTimes(1)
  } finally {
    await composition.dispose()
  }
})
