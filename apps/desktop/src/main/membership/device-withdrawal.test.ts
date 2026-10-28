// 验证撤销确认绑定主进程可信身份、逻辑会话与设备代次，同族刷新保持而旧确认不能作用于新会话。
import { expect, it, vi } from "vitest"
import { createDesktopComposition } from "../composition"
import { PigclaudeApiError, type PigclaudeApi } from "../api/pigclaude-api-client"
import {
  deferred,
  membershipView,
  oauthSessionFixture,
  profileApi,
  ProfileVault,
  seedProfile,
} from "../testing/profile-fixture"
const original = oauthSessionFixture()
async function setup(overrides: Partial<PigclaudeApi> = {}, scope = original.scope) {
  const vault = new ProfileVault()
  await seedProfile(vault)
  await vault.set("membership:session", JSON.stringify({ ...original, scope }))
  const revoke = vi.fn<(token?: string) => Promise<void>>(async () => undefined)
  let now = 2000
  const composition = createDesktopComposition({
    vault,
    authOrigin: "https://auth.example.test",
    now: () => now,
    api: profileApi({
      inspectMembership: async () => ({
        ...membershipView(),
        account: { userId: original.userId, nickname: "A", email: "a@example.test", avatar: "" },
      }),
      revokeDeviceBinding: revoke,
      ...overrides,
    }),
  })
  const view = await composition.resume()
  return {
    vault,
    composition,
    revoke,
    context: view.actionContextId ?? "",
    advance: () => {
      now += 121000
    },
  }
}
it("reads a confirmation without revoking, then submits that target exactly once", async () => {
  const entered = deferred<void>(),
    release = deferred<void>()
  const revoke = vi.fn(async () => {
    entered.resolve(undefined)
    await release.promise
  })
  const f = await setup({ revokeDeviceBinding: revoke })
  try {
    const confirmation = await f.composition.prepareWithdrawal(f.context)
    expect(confirmation.confirmationId).toEqual(expect.any(String))
    expect(revoke).not.toHaveBeenCalled()
    const pending = f.composition.withdraw(confirmation.confirmationId)
    await entered.promise
    await expect(f.composition.withdraw(confirmation.confirmationId)).rejects.toThrow()
    release.resolve(undefined)
    expect(await pending).toMatchObject({ state: "signed_out" })
    expect(revoke).toHaveBeenCalledTimes(1)
    expect(await f.vault.get("authorization:claude-account:other-account")).toBe(
      "old-claude-secret",
    )
    expect(await f.vault.get("device:identity")).toBe("device-identity-sentinel")
  } finally {
    release.resolve(undefined)
    await f.composition.dispose()
  }
})
it.each(["new-grant", "sign-out", "expired"])(
  "rejects an old confirmation after %s",
  async (reason) => {
    const f = await setup()
    try {
      const confirmation = await f.composition.prepareWithdrawal(f.context)
      if (reason === "new-grant")
        await f.composition.membershipGate.acceptAuthorization({
          ...original,
          accessToken: "new-access",
          refreshToken: "new-refresh",
        })
      else if (reason === "sign-out") await f.composition.signOut()
      else f.advance()
      await expect(f.composition.withdraw(confirmation.confirmationId)).rejects.toThrow()
      expect(f.revoke).not.toHaveBeenCalled()
      if (reason === "new-grant")
        expect((await f.composition.tokenManager.snapshot())?.record.accessToken).toBe("new-access")
    } finally {
      await f.composition.dispose()
    }
  },
)
it("keeps confirmation valid across a legal refresh and uses the current bearer", async () => {
  const f = await setup({
    refreshToken: async () => ({
      access_token: "rotated-access",
      refresh_token: "rotated-refresh",
      token_type: "Bearer",
      expires_in: 300,
      scope: original.scope,
    }),
  })
  try {
    const confirmation = await f.composition.prepareWithdrawal(f.context)
    await f.composition.tokenManager.run(async (current) => {
      if (current.record.accessToken !== "rotated-access")
        throw new PigclaudeApiError("invalid_token", 401, "invalid_token")
    })
    await f.composition.withdraw(confirmation.confirmationId)
    expect(f.revoke).toHaveBeenCalledWith("rotated-access")
  } finally {
    await f.composition.dispose()
  }
})
it("does not revoke a changed server relationship from the old confirmation", async () => {
  let changed = false
  const f = await setup({
    readDesktopSession: async () => ({
      ...original,
      bindingEpoch: changed ? "3" : original.bindingEpoch,
    }),
  })
  try {
    const confirmation = await f.composition.prepareWithdrawal(f.context)
    changed = true
    await expect(f.composition.withdraw(confirmation.confirmationId)).rejects.toThrow()
    expect(f.revoke).not.toHaveBeenCalled()
  } finally {
    await f.composition.dispose()
  }
})
it("reports missing revoke permission before preparing a usable confirmation", async () => {
  const f = await setup({}, "user:read")
  try {
    await expect(f.composition.prepareWithdrawal(f.context)).rejects.toMatchObject({
      code: "insufficient_scope",
    })
    expect(f.revoke).not.toHaveBeenCalled()
  } finally {
    await f.composition.dispose()
  }
})
it("ignores late revoke completion after a new native session is committed", async () => {
  const entered = deferred<void>(),
    release = deferred<void>()
  const f = await setup({
    revokeDeviceBinding: async () => {
      entered.resolve(undefined)
      await release.promise
    },
  })
  try {
    const confirmation = await f.composition.prepareWithdrawal(f.context)
    const pending = f.composition
      .withdraw(confirmation.confirmationId)
      .catch((error: unknown) => error)
    await entered.promise
    await f.composition.membershipGate.acceptAuthorization({
      ...original,
      accessToken: "new-access",
      refreshToken: "new-refresh",
    })
    release.resolve(undefined)
    await pending
    expect((await f.composition.tokenManager.snapshot())?.record.accessToken).toBe("new-access")
    expect(f.composition.membershipGate.view().state).not.toBe("signed_out")
  } finally {
    release.resolve(undefined)
    await f.composition.dispose()
  }
})

it("does not let an older preparation replace a later confirmation", async () => {
  let armed = false,
    first = true
  const entered = deferred<void>(),
    release = deferred<void>()
  const f = await setup({
    readDesktopSession: async () => {
      if (armed && first) {
        first = false
        entered.resolve(undefined)
        await release.promise
      }
      return original
    },
  })
  try {
    armed = true
    const old = f.composition.prepareWithdrawal(f.context).catch((error: unknown) => error)
    await entered.promise
    const fresh = await f.composition.prepareWithdrawal(f.context)
    release.resolve(undefined)
    expect(await old).toMatchObject({ code: "WITHDRAWAL_TARGET_CHANGED" })
    await f.composition.withdraw(fresh.confirmationId)
    expect(f.revoke).toHaveBeenCalledTimes(1)
  } finally {
    release.resolve(undefined)
    await f.composition.dispose()
  }
})

it("does not mistake concurrent sign-out for a successful device withdrawal", async () => {
  let armed = false
  const entered = deferred<void>(),
    release = deferred<void>()
  const f = await setup({
    readDesktopSession: async () => {
      if (armed) {
        entered.resolve(undefined)
        await release.promise
      }
      return original
    },
  })
  try {
    const confirmation = await f.composition.prepareWithdrawal(f.context)
    armed = true
    const confirming = f.composition
      .withdraw(confirmation.confirmationId)
      .catch((error: unknown) => error)
    await entered.promise
    await f.composition.signOut()
    release.resolve(undefined)
    expect(await confirming).toMatchObject({ code: "WITHDRAWAL_TARGET_CHANGED" })
    expect(f.revoke).not.toHaveBeenCalled()
  } finally {
    release.resolve(undefined)
    await f.composition.dispose()
  }
})
