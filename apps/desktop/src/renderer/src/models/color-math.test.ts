// 验证颜色运算：十六进制解析、RGB/HSV 转换、混色与 WCAG 对比度。
import { describe, expect, it } from "vitest"
import {
  contrastRatio,
  hexToHsv,
  hexToRgb,
  hsvToHex,
  mixHex,
  parseHex,
  readableOn,
  rgbToHex,
} from "./color-math"

describe("parseHex", () => {
  it("只认 #RRGGBB 并输出大写", () => {
    expect(parseHex("#0169cc")).toBe("#0169CC")
    expect(parseHex("#FFF")).toBeNull()
    expect(parseHex("red")).toBeNull()
  })
})

describe("转换", () => {
  it("hex 与 rgb 互转", () => {
    expect(hexToRgb("#0169CC")).toEqual([1, 105, 204])
    expect(rgbToHex([1, 105, 204])).toBe("#0169CC")
  })

  it("hsv 往返不丢精度", () => {
    expect(hsvToHex(...hexToHsv("#5E6AD2"))).toBe("#5E6AD2")
  })
})

describe("mixHex", () => {
  it("按比例混合", () => {
    expect(mixHex("#000000", "#FFFFFF", 0.5)).toBe("#808080")
  })
})

describe("对比度", () => {
  it("黑白为 21，灰与白约 4.48", () => {
    expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(21, 5)
    expect(contrastRatio("#777777", "#FFFFFF")).toBeCloseTo(4.48, 2)
  })

  it("readableOn 选对比度大的一方", () => {
    expect(readableOn("#339CFF")).toBe("#000000")
    expect(readableOn("#18181B")).toBe("#FFFFFF")
  })
})
