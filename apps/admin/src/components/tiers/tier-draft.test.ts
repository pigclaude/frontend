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
