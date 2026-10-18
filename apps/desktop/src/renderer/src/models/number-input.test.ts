// 校验外观页数字输入框的取值规则：步长 0.5、上下限夹紧、非法输入不生效。
import { describe, expect, it } from "vitest"
import { exactStepped, parseStepped } from "./number-input"

const range = { min: 11, max: 18, step: 0.5 }

describe("parseStepped", () => {
  it("合法值原样返回", () => {
    expect(parseStepped("13", range)).toBe(13)
    expect(parseStepped("13.5", range)).toBe(13.5)
  })

  it("按步长四舍五入", () => {
    expect(parseStepped("13.2", range)).toBe(13)
    expect(parseStepped("13.3", range)).toBe(13.5)
    expect(parseStepped("13.75", range)).toBe(14)
  })

  it("超出范围时贴边", () => {
    expect(parseStepped("4", range)).toBe(11)
    expect(parseStepped("99", range)).toBe(18)
    expect(parseStepped("-3", range)).toBe(11)
  })

  it("空白、非数字和无穷大返回 null", () => {
    expect(parseStepped("", range)).toBeNull()
    expect(parseStepped("  ", range)).toBeNull()
    expect(parseStepped("abc", range)).toBeNull()
    expect(parseStepped("Infinity", range)).toBeNull()
  })

  it("容忍首尾空白", () => {
    expect(parseStepped(" 12.5 ", range)).toBe(12.5)
  })
})

describe("exactStepped", () => {
  it("只有已在范围内且落在步长上的值才立即生效", () => {
    expect(exactStepped("12.5", range)).toBe(12.5)
    expect(exactStepped("1", range)).toBeNull()
    expect(exactStepped("12.3", range)).toBeNull()
    expect(exactStepped("19", range)).toBeNull()
    expect(exactStepped("", range)).toBeNull()
  })
})
