// 负责验证真实组合的实时会员检查、逻辑刷新归属、撤销与受限操作停用。
import { expect, it, vi } from "vitest"
import { createDesktopComposition } from "../composition"
import {
  deferred,
  membershipView,
  oauthSessionFixture,
  profileApi,
  ProfileVault,
  seedProfile,
} from "../testing/profile-fixture"

async function setup(overrides: Parameters<typeof profileApi>[0] = {}) {
  const vault = new ProfileVault()
  await seedProfile(vault)
  const api = profileApi(overrides)
  const composition = createDesktopComposition({
    vault,
    api,
    authOrigin: "http://127.0.0.1:8788",
    now: () => 1_000,
  })
  return {
    vault,
    api,
    composition,
    gate: composition.membershipGate,
    tokens: composition.tokenManager,
  }
}

it.each([false, true])(
  "pending revoke survives same-family refresh; explicit same-metadata new grant supersedes: %s",
  async (newGrant) => {
    const entered = deferred<void>()
    const release = deferred<void>()
    const f = await setup({
      revokeDeviceBinding: async (token) => {
        expect(token).toBe("new-fixture-access")
        entered.resolve(undefined)
        await release.promise
      },
      refreshToken: async () => ({
        access_token: "rotated",
        refresh_token: "rotated-refresh",
        token_type: "Bearer",
        expires_in: 300,
        scope: oauthSessionFixture().scope,
      }),
    })
    await f.gate.inspect()
    const revoking = f.gate.revoke()
    await entered.promise
    await f.tokens.run(async ({ record }) => {
      if (record.accessToken !== "rotated")
        throw Object.assign(new Error(), { code: "invalid_token" })
    })
    await f.gate.inspect()
    if (newGrant) {
      await f.gate.acceptAuthorization({
        ...oauthSessionFixture(),
        accessToken: "new-grant",
        refreshToken: "new-grant-refresh",
      })
      await f.gate.inspect()
    }
    release.resolve(undefined)
    await revoking
    expect(f.gate.view().state).toBe(newGrant ? "active" : "signed_out")
    if (newGrant) expect(await f.vault.get("membership:session")).toContain("new-grant-refresh")
    else expect(await f.vault.get("membership:session")).toBeNull()
    await f.composition.dispose()
  },
)

it.each(["ACCOUNT_BANNED", "DEVICE_REVOKED", "invalid_grant"])(
  "old same-owner terminal %s clears even while newer read is pending",
  async (code) => {
    const oldEntered = deferred<void>()
    const newEntered = deferred<void>()
    const oldRelease = deferred<void>()
    const newRelease = deferred<void>()
    let reads = 0
    const f = await setup({
      inspectMembership: async () => {
        if (++reads === 2) {
          oldEntered.resolve(undefined)
          await oldRelease.promise
          throw Object.assign(new Error(), { code })
        }
        if (reads === 3) {
          newEntered.resolve(undefined)
          await newRelease.promise
        }
        return membershipView()
      },
    })
    await f.gate.inspect()
    const old = f.gate.inspect()
    await oldEntered.promise
    const latest = f.gate.inspect()
    await newEntered.promise
    oldRelease.resolve(undefined)
    await old
    expect(f.gate.view().errorCode).toBe(code)
    expect(await f.vault.get("membership:session")).toBeNull()
    newRelease.resolve(undefined)
    await latest
    expect(f.gate.view().errorCode).toBe(code)
    await f.composition.dispose()
  },
)

it.each(["ACCOUNT_BANNED", "DEVICE_REVOKED", "invalid_grant"])(
  "old terminal %s cannot delete an explicit new grant",
  async (code) => {
    const entered = deferred<void>()
    const release = deferred<void>()
    let reads = 0
    const f = await setup({
      inspectMembership: async () => {
        if (++reads === 1) {
          entered.resolve(undefined)
          await release.promise
          throw Object.assign(new Error(), { code })
        }
        return membershipView()
      },
    })
    const old = f.gate.inspect()
    await entered.promise
    await f.gate.acceptAuthorization(oauthSessionFixture())
    await f.gate.inspect()
    release.resolve(undefined)
    await old
    expect(f.gate.view().state).toBe("active")
    expect(await f.vault.get("membership:session")).not.toBeNull()
    await f.composition.dispose()
  },
)

it("inactive member with original restricted scope can withdraw but cannot run member operations", async () => {
  const revoke = vi.fn(async () => undefined)
  const inspect = vi.fn(async () => membershipView())
  const f = await setup({ revokeDeviceBinding: revoke, inspectMembership: inspect })
  await f.gate.acceptAuthorization({ ...oauthSessionFixture(), scope: "user:read device:revoke" })
  expect(await f.gate.inspect()).toMatchObject({
    state: "verification_required",
    account: { userId: "user-fixture" },
  })
  const operation = vi.fn(async () => undefined)
  await expect(f.composition.runAuthorized(operation)).rejects.toThrow("MEMBERSHIP_REQUIRED")
  expect(operation).not.toHaveBeenCalled()
  expect(inspect).not.toHaveBeenCalled()
  expect(await f.gate.revoke()).toMatchObject({ state: "signed_out" })
  expect(revoke).toHaveBeenCalledWith("new-fixture-access")
  await f.composition.dispose()
})

it("restart rechecks original versions instead of copying a new DB version into old tokens", async () => {
  const f = await setup({
    readDesktopSession: async () => ({
      userId: "user-fixture",
      deviceId: oauthSessionFixture().deviceId,
      bindingEpoch: "2",
      authVersion: "2",
    }),
  })
  expect(await f.gate.inspect()).toMatchObject({ state: "device_revoked" })
  expect(await f.vault.get("membership:session")).toBeNull()
  await f.composition.dispose()
})

it("real composition starts a 30 second heartbeat, aborts operations on ban, and tears down", async () => {
  vi.useFakeTimers()
  try {
    let code: string | null = null
    const inspect = vi.fn(async () => {
      if (code) throw Object.assign(new Error(), { code })
      return membershipView()
    })
    const f = await setup({ inspectMembership: inspect })
    const entered = deferred<void>()
    const stopped = deferred<void>()
    const operation = f.composition
      .runAuthorized(async (signal) => {
        signal.addEventListener("abort", () => stopped.resolve(undefined), { once: true })
        entered.resolve(undefined)
        await stopped.promise
      })
      .catch((error: unknown) => error)
    await entered.promise
    expect(inspect).toHaveBeenCalledTimes(1)
    code = "ACCOUNT_BANNED"
    await vi.advanceTimersByTimeAsync(30_000)
    await operation
    expect(f.gate.view().errorCode).toBe("ACCOUNT_BANNED")
    expect(await f.vault.get("membership:session")).toBeNull()
    await f.composition.dispose()
    const count = inspect.mock.calls.length
    await vi.advanceTimersByTimeAsync(60_000)
    expect(inspect).toHaveBeenCalledTimes(count)
  } finally {
    vi.useRealTimers()
  }
})

it("offline foreground and each restricted operation recheck without offline permission", async () => {
  let online = true
  const inspect = vi.fn(async () => {
    if (!online) throw Object.assign(new Error(), { code: "SERVER_UNAVAILABLE" })
    return membershipView()
  })
  const f = await setup({ inspectMembership: inspect })
  await f.gate.inspect()
  online = false
  expect(await f.composition.resume()).toMatchObject({
    state: "network_grace",
    offlineValidUntil: null,
  })
  const operation = vi.fn(async () => undefined)
  await expect(f.composition.runAuthorized(operation)).rejects.toThrow("MEMBERSHIP_REQUIRED")
  expect(inspect).toHaveBeenCalledTimes(3)
  expect(operation).not.toHaveBeenCalled()
  expect(await f.vault.get("membership:session")).not.toBeNull()
  await f.composition.dispose()
})

it("terminal cleanup failure still immediately denies operations with an explicit safe storage error", async () => {
  let banned = false
  const f = await setup({
    inspectMembership: async () => {
      if (banned) throw Object.assign(new Error(), { code: "ACCOUNT_BANNED" })
      return membershipView()
    },
  })
  await f.gate.inspect()
  f.vault.failCleanup = true
  banned = true
  expect(await f.gate.inspect()).toMatchObject({
    state: "configuration_error",
    errorCode: "SAFE_STORAGE_UNAVAILABLE",
  })
  const operation = vi.fn(async () => undefined)
  await expect(f.composition.runAuthorized(operation)).rejects.toThrow("MEMBERSHIP_REQUIRED")
  expect(operation).not.toHaveBeenCalled()
  await f.composition.dispose()
})

it("a superseded failed before-operation read cannot reuse a previous active view", async () => {
  const operationEntered = deferred<void>()
  const operationRelease = deferred<void>()
  const heartbeatEntered = deferred<void>()
  const heartbeatRelease = deferred<void>()
  let reads = 0
  const f = await setup({
    inspectMembership: async () => {
      if (++reads === 2) {
        operationEntered.resolve(undefined)
        await operationRelease.promise
        throw Object.assign(new Error(), { code: "SERVER_UNAVAILABLE" })
      }
      if (reads === 3) {
        heartbeatEntered.resolve(undefined)
        await heartbeatRelease.promise
      }
      return membershipView()
    },
  })
  await f.gate.inspect()
  const operation = vi.fn(async () => undefined)
  const running = f.composition.runAuthorized(operation).catch((error: unknown) => error)
  await operationEntered.promise
  const newer = f.gate.inspect()
  await heartbeatEntered.promise
  operationRelease.resolve(undefined)
  expect(await running).toMatchObject({ message: "MEMBERSHIP_REQUIRED" })
  expect(operation).not.toHaveBeenCalled()
  heartbeatRelease.resolve(undefined)
  await newer
  await f.composition.dispose()
})

it("a failed request cannot borrow a concurrent request's successful check", async () => {
  const entered = deferred<void>()
  const release = deferred<void>()
  let reads = 0
  const f = await setup({
    inspectMembership: async () => {
      if (++reads === 2) {
        entered.resolve(undefined)
        await release.promise
        throw Object.assign(new Error(), { code: "SERVER_UNAVAILABLE" })
      }
      return membershipView()
    },
  })
  try {
    await f.gate.inspect()
    const operation = vi.fn(async () => undefined)
    const pending = f.composition.runAuthorized(operation).catch((error: unknown) => error)
    await entered.promise
    await f.gate.inspect()
    release.resolve(undefined)
    expect(await pending).toMatchObject({ message: "MEMBERSHIP_REQUIRED" })
    expect(operation).not.toHaveBeenCalled()
    expect(f.gate.view().state).toBe("active")
  } finally {
    await f.composition.dispose()
  }
})
