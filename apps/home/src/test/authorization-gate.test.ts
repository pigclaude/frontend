// 负责验证授权按钮对 flow 状态、会员状态和 replace 确认的 gate。
import { describe, expect, it } from "vitest"
import { canApproveAuthorization } from "@/lib/authorization-gate"

describe("authorization gate", () => {
  it("only permits a pending flow with active membership", () => {
    expect(
      canApproveAuthorization({
        flowStatus: "pending",
        membershipStatus: "active",
        requiresReplace: false,
        replaceExisting: false,
      }),
    ).toBe(true)
    for (const flowStatus of ["approved", "expired", "rejected", "consumed"] as const) {
      expect(
        canApproveAuthorization({
          flowStatus,
          membershipStatus: "active",
          requiresReplace: false,
          replaceExisting: false,
        }),
      ).toBe(false)
    }
    for (const membershipStatus of ["inactive", "expired", "revoked"] as const) {
      expect(
        canApproveAuthorization({
          flowStatus: "pending",
          membershipStatus,
          requiresReplace: false,
          replaceExisting: false,
        }),
      ).toBe(false)
    }
  })

  it("requires explicit replacement confirmation when a binding exists", () => {
    expect(
      canApproveAuthorization({
        flowStatus: "pending",
        membershipStatus: "active",
        requiresReplace: true,
        replaceExisting: false,
      }),
    ).toBe(false)
    expect(
      canApproveAuthorization({
        flowStatus: "pending",
        membershipStatus: "active",
        requiresReplace: true,
        replaceExisting: true,
      }),
    ).toBe(true)
  })
})
