// 验证输入单位只做精确字符串转换，并拒绝超精度和科学记数法。
import { describe, expect, it } from "vitest"
import { parseUnits } from "./tier-draft"
describe("parseUnits", () => {
  it("preserves large integer amounts and decimal units", () => {
    expect(parseUnits("90071992547409.91", 2)).toBe("9007199254740991")
    expect(parseUnits("7.5", 3)).toBe("7500")
    expect(parseUnits("000.01", 2)).toBe("1")
  })
  it("rejects rounding, signed values and exponent notation", () => {
    for (const value of ["1.001", "-1", "+1", "1e2", "", " 1"])
      expect(() => parseUnits(value, 2)).toThrow()
  })
})

import { draftFromTier, draftErrors, tierInput } from "./tier-draft"
describe("draft validation", () => {
  function valid() {
    return { ...draftFromTier(null), name: "VIP", code: "vip", monthlyPrice: "100" }
  }
  it("draft errors cover presentation limits", () => {
    const d = valid()
    d.tagline = "😀".repeat(25)
    d.benefits = ["  "]
    d.options[0].badge = "😀".repeat(7)
    expect(draftErrors(d)).toMatchObject({
      tagline: "标语最多 24 个字",
      "benefit.0": "权益不能为空",
      "option.0.badge": "角标最多 6 个字",
    })
    expect(() => tierInput(d)).toThrow()
  })
  it("tier input maps empty badge to null and trims benefits", () => {
    const d = valid()
    d.benefits = [" 权益 "]
    d.options[0].badge = "  "
    expect(tierInput(d)).toMatchObject({ benefits: ["权益"], options: [{ badge: null }] })
  })
  it("counts unicode scalars and preserves boundary fields", () => {
    const d = valid()
    d.tagline = "😀".repeat(24)
    d.benefits = Array(8).fill(" " + "😀".repeat(24) + " ")
    d.options[0].badge = "😀".repeat(6)
    expect(draftErrors(d)).toEqual({})
    expect(tierInput(d).benefits[0]).toBe("😀".repeat(24))
    d.benefits.push("nine")
    expect(draftErrors(d)["benefit.8"]).toBe("最多 8 条权益")
    d.benefits = ["😀".repeat(25)]
    expect(draftErrors(d)["benefit.0"]).toBe("每条权益最多 24 个字")
    d.options.push({ ...d.options[0], recommended: true })
    d.options[0].recommended = true
    expect(draftErrors(d).options).toBe("每个等级最多一个推荐档位")
    d.name = " "
    d.level = "0"
    d.monthlyPrice = "1.001"
    d.options[0].months = "x"
    d.options[0].discountKind = "percent"
    d.options[0].value = "1.0001"
    expect(draftErrors(d)).toHaveProperty("name", "请填写名称")
    expect(draftErrors(d)).toHaveProperty("level")
    expect(draftErrors(d)).toHaveProperty("monthlyPrice")
    expect(draftErrors(d)).toHaveProperty("option.0.months")
    expect(draftErrors(d)).toHaveProperty("option.0.value")
  })
})
