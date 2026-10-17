// 负责验证账户标识脱敏，确保 home UI 不展示完整邮箱和用户 ID。
import { describe, expect, it } from "vitest"
import { maskEmail, maskUserId } from "@/lib/identity-mask"

describe("identity masking", () => {
  it("masks the local part while retaining the email domain", () => {
    expect(maskEmail("ada.lovelace@example.com")).toBe("a•••@example.com")
    expect(maskEmail("a@example.com")).toBe("a•••@example.com")
    expect(maskEmail("@example.com")).toBe("••••")
  })

  it("masks user IDs with stable head and tail fragments", () => {
    expect(maskUserId("user-super-secret-1234")).toBe("user••••1234")
    expect(maskUserId("short")).toBe("••••")
  })
})
