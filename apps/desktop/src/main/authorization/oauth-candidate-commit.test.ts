// 负责从桌面授权编排验证显式切换的候选会话失败、提交与取消的持久结果，不读取真实账号或 Keychain。
import { expect, it } from "vitest"
import { createDesktopComposition } from "../composition"
import type { PigclaudeApi } from "../api/pigclaude-api-client"
import type { AuthorizationStateEvent } from "./types"
import { PigclaudeApiError, type NativeOAuthToken } from "../api/oauth-client"
import { OAuthTokenManager } from "./oauth-token-manager"
import {
  membershipView,
  oauthSessionFixture,
  profileApi,
  ProfileVault,
  seedProfile,
  deferred,
} from "../testing/profile-fixture"

const redirect = "http://127.0.0.1:43123/oauth/callback"
const request = { purpose: "pigclaude-login", mode: "switch" } as const
const original = {
  ...oauthSessionFixture(),
  userId: "user-a",
  accessToken: "access-a",
  refreshToken: "refresh-a",
}
const candidate: NativeOAuthToken = {
  access_token: "access-b",
  refresh_token: "refresh-b",
  token_type: "Bearer",
  expires_in: 300,
  scope: original.scope,
}

async function setup(overrides: Partial<PigclaudeApi> = {}) {
  const vault = new ProfileVault()
  await seedProfile(vault)
  await vault.set("membership:session", JSON.stringify(original))
  const events: AuthorizationStateEvent[] = []
  const composition = createDesktopComposition({
    authOrigin: "http://127.0.0.1:8788",
    vault,
    now: () => 2_000,
    onAuthorizationState: (event: AuthorizationStateEvent) => events.push(event),
    deviceIdentity: {
      read: async () => ({ deviceId: original.deviceId, platform: "darwin" as const }),
    },
    api: profileApi({
      exchangeCode: async () => candidate,
      readDesktopSession: async (accessToken) => ({
        userId: accessToken === "access-a" ? "user-a" : "user-b",
        deviceId: original.deviceId,
        bindingEpoch: original.bindingEpoch,
        authVersion: original.authVersion,
      }),
      inspectMembership: async (_input, accessToken) => ({
        ...membershipView(),
        account: {
          userId: accessToken === "access-a" ? "user-a" : "user-b",
          nickname: "",
          email: "",
          avatar: "",
        },
      }),
      ...overrides,
    }),
  })
  await composition.membershipGate.inspect()
  async function begin() {
    const started = await composition.authorizationService.start(request, redirect)
    const state = composition.authorizationService.getActiveSession()?.state
    return {
      ...started,
      deny: () =>
        composition.authorizationService.handleCallback(
          `${redirect}?error=access_denied&state=${state}`,
        ),
      complete: () =>
        composition.authorizationService.handleCallback(`${redirect}?code=fixture&state=${state}`),
    }
  }
  return { vault, composition, begin, events }
}

it("keeps the committed login and rechecks it when candidate storage fails", async () => {
  const { vault, composition, begin } = await setup()
  try {
    const revision = composition.membershipGate.view().revision
    vault.beforeSet = async () => {
      throw new Error("private disk details")
    }
    const flow = await begin()
    expect(await flow.complete()).toMatchObject({
      status: "exchange-error",
      error: "SAFE_STORAGE_UNAVAILABLE：系统安全存储不可用，授权未保存",
    })
    expect((await composition.tokenManager.snapshot())?.record).toEqual(original)
    expect(composition.membershipGate.view()).toMatchObject({
      state: "active",
      account: { userId: "user-a" },
    })
    expect(composition.membershipGate.view().revision).toBeGreaterThan(revision)
  } finally {
    await composition.dispose()
  }
})

it("rechecks A when the browser denies the candidate authorization", async () => {
  let expired = false
  const { composition, begin } = await setup({
    inspectMembership: async () => membershipView(expired ? "expired" : "active"),
  })
  try {
    const flow = await begin()
    expired = true
    expect(await flow.deny()).toMatchObject({ status: "denied" })
    expect((await composition.tokenManager.snapshot())?.record).toEqual(original)
    expect(composition.membershipGate.view().state).toBe("expired")
  } finally {
    await composition.dispose()
  }
})

it("shows commit progress and finishes an entered save despite a racing cancel", async () => {
  const { vault, composition, begin, events } = await setup()
  const entered = deferred<void>()
  const release = deferred<void>()
  try {
    vault.beforeSet = async () => {
      entered.resolve(undefined)
      await release.promise
    }
    const flow = await begin()
    const completing = flow.complete()
    await entered.promise
    expect(events).toContainEqual(expect.objectContaining({ status: "committing" }))
    expect(await composition.authorizationService.cancel(flow.sessionId)).toMatchObject({
      status: "committing",
    })
    release.resolve(undefined)
    expect(await completing).toMatchObject({ status: "completed", accountId: "user-b" })
    await composition.authorizationService.cancel(flow.sessionId)
    expect((await composition.tokenManager.snapshot())?.record.userId).toBe("user-b")
    const restarted = new OAuthTokenManager({ vault, api: profileApi(), now: () => 2_000 })
    expect((await restarted.snapshot())?.record.userId).toBe("user-b")
    expect(await vault.get("authorization:claude-account:other-account")).toBe("old-claude-secret")
    expect(await vault.get("device:identity")).toBe("device-identity-sentinel")
  } finally {
    release.resolve(undefined)
    await composition.dispose()
  }
})

it("rechecks the original membership after cancelling browser waiting", async () => {
  let expired = false
  const { composition, begin } = await setup({
    inspectMembership: async () => membershipView(expired ? "expired" : "active"),
  })
  try {
    const flow = await begin()
    expired = true
    expect(await composition.authorizationService.cancel(flow.sessionId)).toMatchObject({
      status: "cancelled",
    })
    expect((await composition.tokenManager.snapshot())?.record).toEqual(original)
    expect(composition.membershipGate.view().state).toBe("expired")
  } finally {
    await composition.dispose()
  }
})

it("keeps A after cancelling code HTTP and ignores its late response after B commits", async () => {
  const entered = deferred<void>()
  const response = deferred<NativeOAuthToken>()
  let exchanges = 0
  const { composition, begin } = await setup({
    exchangeCode: async () => {
      if (++exchanges === 1) {
        entered.resolve(undefined)
        return response.promise
      }
      return candidate
    },
  })
  try {
    const old = await begin()
    const completing = old.complete()
    await entered.promise
    await composition.authorizationService.cancel(old.sessionId)
    expect((await composition.tokenManager.snapshot())?.record).toEqual(original)
    const fresh = await begin()
    expect(await fresh.complete()).toMatchObject({ status: "completed", accountId: "user-b" })
    response.resolve({
      access_token: "late-access",
      refresh_token: "late-refresh",
      token_type: "Bearer",
      expires_in: 300,
      scope: original.scope,
    })
    expect(await completing).toMatchObject({ status: "cancelled" })
    expect((await composition.tokenManager.snapshot())?.record.userId).toBe("user-b")
  } finally {
    await composition.dispose()
  }
})

it("rechecks A after exchange failure without trusting its cached active membership", async () => {
  let expired = false
  const { composition, begin } = await setup({
    exchangeCode: async () => {
      throw new Error("private network details")
    },
    inspectMembership: async () => membershipView(expired ? "expired" : "active"),
  })
  try {
    const flow = await begin()
    expired = true
    expect(await flow.complete()).toMatchObject({
      status: "exchange-error",
      error: "授权码交换失败",
    })
    expect((await composition.tokenManager.snapshot())?.record).toEqual(original)
    expect(composition.membershipGate.view().state).toBe("expired")
  } finally {
    await composition.dispose()
  }
})

it("requires authorization when the preserved device relationship is no longer valid", async () => {
  let revoked = false
  const { composition, begin } = await setup({
    readDesktopSession: async () => {
      if (revoked) throw new PigclaudeApiError("DEVICE_REVOKED", 401)
      return original
    },
  })
  try {
    const flow = await begin()
    revoked = true
    await composition.authorizationService.cancel(flow.sessionId)
    expect(composition.membershipGate.view().state).toBe("device_revoked")
    expect(await composition.tokenManager.snapshot()).toBeNull()
  } finally {
    await composition.dispose()
  }
})

it("keeps committed B when a late cancel races its membership check, even if B is expired", async () => {
  const entered = deferred<void>()
  const release = deferred<void>()
  const { vault, composition, begin } = await setup({
    inspectMembership: async (_input, accessToken) => {
      if (accessToken === "access-a") return membershipView()
      entered.resolve(undefined)
      await release.promise
      return {
        ...membershipView("expired"),
        account: { userId: "user-b", nickname: "", email: "", avatar: "" },
      }
    },
  })
  try {
    const flow = await begin()
    const completing = flow.complete()
    await entered.promise
    expect(await composition.authorizationService.cancel(flow.sessionId)).toMatchObject({
      status: "committing",
    })
    release.resolve(undefined)
    expect(await completing).toMatchObject({ status: "completed", accountId: "user-b" })
    expect(composition.membershipGate.view().state).toBe("expired")
    const restarted = new OAuthTokenManager({ vault, api: profileApi(), now: () => 2_000 })
    expect((await restarted.snapshot())?.record).toMatchObject({
      userId: "user-b",
      refreshToken: "refresh-b",
    })
  } finally {
    release.resolve(undefined)
    await composition.dispose()
  }
})

it("never lends A's active view to B when overlapping B checks finish out of order", async () => {
  const firstEntered = deferred<void>()
  const secondEntered = deferred<void>()
  const firstRelease = deferred<void>()
  const secondRelease = deferred<void>()
  let checks = 0
  const { composition, begin } = await setup({
    inspectMembership: async (_input, accessToken) => {
      if (accessToken === "access-a") return membershipView()
      const first = ++checks === 1
      ;(first ? firstEntered : secondEntered).resolve(undefined)
      await (first ? firstRelease : secondRelease).promise
      return {
        ...membershipView(),
        account: { userId: "user-b", nickname: "", email: "", avatar: "" },
      }
    },
  })
  try {
    const flow = await begin()
    const completing = flow.complete()
    await firstEntered.promise
    const resuming = composition.resume()
    await secondEntered.promise
    firstRelease.resolve(undefined)
    expect(await completing).toMatchObject({ status: "completed", accountId: "user-b" })
    expect(composition.membershipGate.view()).toMatchObject({
      state: "connecting",
      account: { userId: "user-b" },
    })
    secondRelease.resolve(undefined)
    expect(await resuming).toMatchObject({ state: "active", account: { userId: "user-b" } })
  } finally {
    firstRelease.resolve(undefined)
    secondRelease.resolve(undefined)
    await composition.dispose()
  }
})

it("never restores either login when explicit sign-out wins during account switching", async () => {
  const entered = deferred<void>()
  const response = deferred<NativeOAuthToken>()
  const { vault, composition, begin } = await setup({
    exchangeCode: async () => {
      entered.resolve(undefined)
      return response.promise
    },
  })
  try {
    const flow = await begin()
    const completing = flow.complete()
    await entered.promise
    await composition.signOut()
    response.resolve(candidate)
    expect(await completing).toMatchObject({ status: "cancelled" })
    await composition.authorizationService.cancel(flow.sessionId)
    expect(await composition.tokenManager.snapshot()).toBeNull()
    expect(composition.membershipGate.view().state).toBe("signed_out")
    expect(await vault.get("authorization:claude-account:other-account")).toBe("old-claude-secret")
    expect(await vault.get("device:identity")).toBe("device-identity-sentinel")
  } finally {
    response.resolve(candidate)
    await composition.dispose()
  }
})
