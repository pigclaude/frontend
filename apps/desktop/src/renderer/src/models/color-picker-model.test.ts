// 验证颜色选择器的纯运算：指针位置换算、键盘步进、HSV 同步、HEX 输入解析和对比度说明。
import { describe, expect, it } from "vitest"
import {
  contrastNote,
  hsvFromHex,
  hsvHex,
  hueFromPoint,
  parseHexInput,
  stepHue,
  stepSv,
  svFromPoint,
  syncHsv,
} from "./color-picker-model"

const rect = { left: 10, top: 20, width: 200, height: 100 }

describe("svFromPoint", () => {
  it("左上是白（s=0, v=1），右下是黑（s=1, v=0）", () => {
    expect(svFromPoint(10, 20, rect)).toEqual({ s: 0, v: 1 })
    expect(svFromPoint(210, 120, rect)).toEqual({ s: 1, v: 0 })
    expect(svFromPoint(60, 95, rect)).toEqual({ s: 0.25, v: 0.25 })
  })

  it("拖出方块时限制在边上", () => {
    expect(svFromPoint(-500, -500, rect)).toEqual({ s: 0, v: 1 })
    expect(svFromPoint(999, 999, rect)).toEqual({ s: 1, v: 0 })
  })

  it("零尺寸不产生 NaN", () => {
    expect(svFromPoint(10, 20, { left: 10, top: 20, width: 0, height: 0 })).toEqual({ s: 0, v: 1 })
  })
})

describe("hueFromPoint", () => {
  it("从左到右是 0–360，越界时限制", () => {
    expect(hueFromPoint(10, rect)).toBe(0)
    expect(hueFromPoint(110, rect)).toBe(180)
    expect(hueFromPoint(210, rect)).toBe(360)
    expect(hueFromPoint(-1, rect)).toBe(0)
    expect(hueFromPoint(1000, rect)).toBe(360)
  })
})

describe("stepSv", () => {
  const base = { h: 200, s: 0.5, v: 0.5 }

  it("左右改饱和度，上下改亮度，每次 1%", () => {
    expect(stepSv(base, "ArrowRight", false)?.s).toBeCloseTo(0.51)
    expect(stepSv(base, "ArrowLeft", false)?.s).toBeCloseTo(0.49)
    expect(stepSv(base, "ArrowUp", false)?.v).toBeCloseTo(0.51)
    expect(stepSv(base, "ArrowDown", false)?.v).toBeCloseTo(0.49)
  })

  it("按住 Shift 每次 10%，色相不变", () => {
    const next = stepSv(base, "ArrowRight", true)
    expect(next?.s).toBeCloseTo(0.6)
    expect(next?.h).toBe(200)
  })

  it("限制在 0–1，其他按键返回 null", () => {
    expect(stepSv({ h: 0, s: 1, v: 0 }, "ArrowRight", false)).toEqual({ h: 0, s: 1, v: 0 })
    expect(stepSv({ h: 0, s: 1, v: 0 }, "ArrowDown", false)).toEqual({ h: 0, s: 1, v: 0 })
    expect(stepSv(base, "Enter", false)).toBeNull()
  })
})

describe("stepHue", () => {
  it("每次 1%（3.6°），Shift 时 10%，限制在 0–360", () => {
    expect(stepHue(180, "ArrowRight", false)).toBeCloseTo(183.6)
    expect(stepHue(180, "ArrowUp", false)).toBeCloseTo(183.6)
    expect(stepHue(180, "ArrowLeft", true)).toBeCloseTo(144)
    expect(stepHue(1, "ArrowDown", false)).toBe(0)
    expect(stepHue(359, "ArrowRight", false)).toBe(360)
  })

  it("Home/End 到两端，其他按键返回 null", () => {
    expect(stepHue(120, "Home", false)).toBe(0)
    expect(stepHue(120, "End", false)).toBe(360)
    expect(stepHue(120, "a", false)).toBeNull()
  })
})

describe("syncHsv", () => {
  it("外部颜色与当前 HSV 一致时原样保留", () => {
    const prev = { h: 210, s: 0.4, v: 0.6 }
    expect(syncHsv(prev, hsvHex(prev))).toBe(prev)
  })

  it("拖到黑色后色相和饱和度不丢", () => {
    const prev = { h: 210, s: 0.4, v: 0 }
    expect(syncHsv(prev, "#000000")).toBe(prev)
    expect(syncHsv({ h: 120, s: 0.7, v: 0.3 }, "#000000")).toEqual({ h: 120, s: 0.7, v: 0 })
  })

  it("变成灰色时保留色相", () => {
    expect(syncHsv({ h: 120, s: 0.7, v: 0.3 }, "#808080")).toEqual({
      h: 120,
      s: 0,
      v: 128 / 255,
    })
  })

  it("外部换成新颜色时按新颜色计算", () => {
    expect(syncHsv({ h: 120, s: 0.7, v: 0.3 }, "#FF0000")).toEqual({ h: 0, s: 1, v: 1 })
  })

  it("hsvFromHex 与 hsvHex 往返一致", () => {
    expect(hsvHex(hsvFromHex("#5E6AD2"))).toBe("#5E6AD2")
  })
})

describe("parseHexInput", () => {
  it("接受带或不带 #、大小写、首尾空白的 6 位 HEX", () => {
    expect(parseHexInput("#0169cc")).toBe("#0169CC")
    expect(parseHexInput("0169cc")).toBe("#0169CC")
    expect(parseHexInput("  #0169CC ")).toBe("#0169CC")
  })

  it("其他输入一律返回 null", () => {
    expect(parseHexInput("zz")).toBeNull()
    expect(parseHexInput("")).toBeNull()
    expect(parseHexInput("#fff")).toBeNull()
    expect(parseHexInput("##0169cc")).toBeNull()
    expect(parseHexInput("#0169ccd")).toBeNull()
  })
})

describe("contrastNote", () => {
  it("显示一位小数的对比度", () => {
    expect(contrastNote("前景", 7.25, 4.5)).toEqual({ text: "前景 · 对比度 7.2", low: false })
    expect(contrastNote("背景", 21, 4.5)).toEqual({ text: "背景 · 对比度 21.0", low: false })
  })

  it("低于下限时追加「· 偏低」", () => {
    expect(contrastNote("强调色", 2.4, 3)).toEqual({
      text: "强调色 · 对比度 2.4 · 偏低",
      low: true,
    })
  })

  it("只舍不入，不会把 2.96 显示成合格的 3.0", () => {
    expect(contrastNote("强调色", 2.96, 3)).toEqual({
      text: "强调色 · 对比度 2.9 · 偏低",
      low: true,
    })
    expect(contrastNote("强调色", 3, 3)).toEqual({ text: "强调色 · 对比度 3.0", low: false })
  })
})
