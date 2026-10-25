// 负责验证邮箱脱敏，确保 home UI 不展示完整邮箱。
import { describe, expect, it } from "vitest"
import { maskEmail } from "@/lib/identity-mask"

describe("identity masking", () => {
  it("masks the local part while retaining the email domain", () => {
    expect(maskEmail("ada.lovelace@example.com")).toBe("a•••@example.com")
    expect(maskEmail("a@example.com")).toBe("a•••@example.com")
    expect(maskEmail("@example.com")).toBe("••••")
  })
})
