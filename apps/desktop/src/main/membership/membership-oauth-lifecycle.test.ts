// 负责验证远端撤销不阻塞本机退出，以及固定封禁/撤销错误只清理第一方材料。
import { expect, it } from "vitest"
import { MembershipGate } from "./membership-gate"
import {
  deferred,
  membershipView,
  oauthSessionFixture,
  ProfileVault,
  seedProfile,
} from "../testing/profile-fixture"

it.each(["success", "ACCOUNT_BANNED", "DEVICE_REVOKED"])(
  "does not wait for revoke %s on logout or let its late result clear a new login",
  async (outcome) => {
    const vault = new ProfileVault()
    await seedProfile(vault)
    const entered = deferred<void>()
    const response = deferred<void>()
    const gate = new MembershipGate({
      vault,
      api: {
        inspectMembership: async (input) => ({
          ...membershipView(),
          bindingEpoch: input.bindingEpoch,
        }),
        revokeDeviceBinding: async (token) => {
          expect(token).toBe("new-fixture-access")
          entered.resolve(undefined)
          await response.promise
          if (outcome !== "success") throw Object.assign(new Error(outcome), { code: outcome })
        },
      },
    })
    await gate.inspect()
    const revoke = gate.revoke()
    await entered.promise
    await gate.signOut()
    await gate.acceptAuthorization({
      ...oauthSessionFixture(),
      bindingEpoch: "3",
      accessToken: "fresh-access",
      refreshToken: "fresh-refresh",
    })
    await gate.inspect()
    response.resolve(undefined)
    await revoke
    expect(gate.view()).toMatchObject({ state: "active", bindingEpoch: "3" })
    expect(await vault.get("membership:session")).toContain("fresh-refresh")
    expect(await vault.get("authorization:claude-account:other-account")).toBe("old-claude-secret")
  },
)
it.each(["ACCOUNT_BANNED", "DEVICE_REVOKED"])(
  "clears unusable first-party credentials for %s while preserving Claude",
  async (code) => {
    const vault = new ProfileVault()
    await seedProfile(vault)
    const gate = new MembershipGate({
      vault,
      api: {
        inspectMembership: async () => {
          throw Object.assign(new Error(code), { code })
        },
        revokeDeviceBinding: async () => {
          throw new Error("must not revoke")
        },
      },
    })
    expect(await gate.inspect()).toMatchObject({
      state: code === "DEVICE_REVOKED" ? "device_revoked" : "verification_required",
      errorCode: code,
    })
    expect(await vault.get("membership:session")).toBeNull()
    expect(await vault.get("authorization:pigclaude-login:old-user")).toBeNull()
    expect(await vault.get("authorization:claude-account:other-account")).toBe("old-claude-secret")
  },
)
