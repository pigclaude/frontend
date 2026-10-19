// 负责区分同一授权的普通读取与真正更换凭据，验证撤销后置状态和读取最新性。
import { expect, it } from "vitest"
import { MembershipGate } from "./membership-gate"
import type { MembershipView } from "@pigclaude/contracts/membership"
import {
  deferred,
  membershipView,
  oauthSessionFixture,
  ProfileVault,
  seedProfile,
} from "../testing/profile-fixture"

it.each([
  ["success", false],
  ["ACCOUNT_BANNED", false],
  ["DEVICE_REVOKED", false],
  ["success", true],
  ["ACCOUNT_BANNED", true],
  ["DEVICE_REVOKED", true],
] as const)(
  "settles current revoke %s even when same-session inspect runs: %s",
  async (outcome, inspectAgain) => {
    const vault = new ProfileVault()
    await seedProfile(vault)
    const entered = deferred<void>()
    const release = deferred<void>()
    let reads = 0
    const gate = new MembershipGate({
      vault,
      api: {
        inspectMembership: async (_input, token) => {
          expect(token).toBe("new-fixture-access")
          reads++
          return membershipView()
        },
        revokeDeviceBinding: async (token) => {
          expect(token).toBe("new-fixture-access")
          entered.resolve(undefined)
          await release.promise
          if (outcome !== "success") throw Object.assign(new Error(outcome), { code: outcome })
        },
      },
    })
    expect(await gate.inspect()).toMatchObject({ state: "active" })
    const revoking = gate.revoke().catch((error: unknown) => error)
    await entered.promise
    if (inspectAgain) expect(await gate.inspect()).toMatchObject({ state: "active" })
    expect(reads).toBe(inspectAgain ? 2 : 1)
    release.resolve(undefined)
    expect(await revoking).toMatchObject({
      state:
        outcome === "success"
          ? "signed_out"
          : outcome === "DEVICE_REVOKED"
            ? "device_revoked"
            : "verification_required",
    })
    expect(gate.view()).toMatchObject({
      state:
        outcome === "success"
          ? "signed_out"
          : outcome === "DEVICE_REVOKED"
            ? "device_revoked"
            : "verification_required",
      errorCode: outcome === "success" ? null : outcome,
    })
    expect(await vault.get("membership:session")).toBeNull()
    expect(await vault.get("authorization:pigclaude-login:old-user")).toBeNull()
    expect(await vault.get("authorization:claude-account:other-account")).toBe("old-claude-secret")
  },
)

it.each(["success", "ACCOUNT_BANNED", "DEVICE_REVOKED"])(
  "ignores old revoke %s after a new grant for the same user/device/epoch",
  async (outcome) => {
    const vault = new ProfileVault()
    await seedProfile(vault)
    const entered = deferred<void>()
    const release = deferred<void>()
    const gate = new MembershipGate({
      vault,
      api: {
        inspectMembership: async () => membershipView(),
        revokeDeviceBinding: async () => {
          entered.resolve(undefined)
          await release.promise
          if (outcome !== "success") throw Object.assign(new Error(outcome), { code: outcome })
        },
      },
    })
    await gate.inspect()
    const revoking = gate.revoke().catch((error: unknown) => error)
    await entered.promise
    await gate.acceptAuthorization({
      ...oauthSessionFixture(),
      accessToken: "new-grant-access",
      refreshToken: "new-grant-refresh",
    })
    await gate.inspect()
    release.resolve(undefined)
    await revoking
    expect(gate.view()).toMatchObject({ state: "active", errorCode: null })
    expect(await vault.get("membership:session")).toContain("new-grant-refresh")
    expect(await vault.get("authorization:claude-account:other-account")).toBe("old-claude-secret")
  },
)

it.each(["result", "error"])(
  "still publishes only the newest same-session inspect %s",
  async (outcome) => {
    const vault = new ProfileVault()
    await seedProfile(vault)
    const entered = deferred<void>()
    const release = deferred<void>()
    let reads = 0
    const gate = new MembershipGate({
      vault,
      api: {
        inspectMembership: async () => {
          const read = ++reads
          if (read === 2) {
            entered.resolve(undefined)
            await release.promise
            if (outcome === "error")
              throw Object.assign(new Error("unavailable"), { code: "SERVER_UNAVAILABLE" })
            return membershipView("active")
          }
          return membershipView(read === 3 ? "expired" : "active")
        },
        revokeDeviceBinding: async () => {
          throw new Error("unused revoke")
        },
      },
    })
    await gate.inspect()
    const older = gate.inspect()
    await entered.promise
    expect(await gate.inspect()).toMatchObject({ state: "expired" })
    expect(reads).toBe(3)
    release.resolve(undefined)
    await older
    expect(gate.view()).toMatchObject({ state: "expired", errorCode: null })
    expect(await vault.get("membership:session")).toContain("new-fixture-refresh")
  },
)

it("ignores an active inspect already in flight when successful revoke clears the owner", async () => {
  const vault = new ProfileVault()
  await seedProfile(vault)
  const entered = deferred<void>()
  const response = deferred<MembershipView>()
  let reads = 0
  const gate = new MembershipGate({
    vault,
    api: {
      inspectMembership: async () => {
        if (++reads === 2) {
          entered.resolve(undefined)
          return response.promise
        }
        return membershipView()
      },
      revokeDeviceBinding: async () => undefined,
    },
  })
  await gate.inspect()
  const inspection = gate.inspect()
  await entered.promise
  await gate.revoke()
  response.resolve(membershipView())
  await inspection
  expect(gate.view()).toMatchObject({ state: "signed_out" })
  expect(await vault.get("membership:session")).toBeNull()
})

it.each(["insufficient_scope", "MEMBERSHIP_EXPIRED", "SERVER_UNAVAILABLE"])(
  "retains the current session without retry for nonterminal revoke %s",
  async (code) => {
    const vault = new ProfileVault()
    await seedProfile(vault)
    let calls = 0
    const gate = new MembershipGate({
      vault,
      api: {
        inspectMembership: async () => membershipView(),
        revokeDeviceBinding: async () => {
          calls++
          throw Object.assign(new Error(code), { code })
        },
      },
    })
    await gate.inspect()
    await expect(gate.revoke()).rejects.toMatchObject({ code })
    expect(calls).toBe(1)
    expect(gate.view()).toMatchObject({ state: "active" })
    expect(await vault.get("membership:session")).toContain("new-fixture-refresh")
  },
)

it("does not bind an old visible revoke to a replacement grant whose local write is in flight", async () => {
  const vault = new ProfileVault()
  await seedProfile(vault)
  const entered = deferred<void>()
  const release = deferred<void>()
  let calls = 0
  const gate = new MembershipGate({
    vault,
    api: {
      inspectMembership: async () => membershipView(),
      revokeDeviceBinding: async () => {
        calls++
      },
    },
  })
  await gate.inspect()
  vault.beforeSet = async (key) => {
    if (key === "membership:session") {
      entered.resolve(undefined)
      await release.promise
    }
  }
  const writing = gate.acceptAuthorization({
    ...oauthSessionFixture(),
    accessToken: "replacement-access",
    refreshToken: "replacement-refresh",
  })
  await entered.promise
  const revoking = gate.revoke()
  release.resolve(undefined)
  await writing
  await revoking
  expect(calls).toBe(0)
  expect(await vault.get("membership:session")).toContain("replacement-refresh")
  expect(await gate.inspect()).toMatchObject({ state: "active" })
})
