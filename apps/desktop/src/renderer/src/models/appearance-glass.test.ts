// 校验磨砂透明度曲线：g=60 穿过 glass.css 原值、g=0 实心、单调不增、表面不比底层更透、弹层下限。
import { describe, expect, it } from "vitest"
import { alphaAt, glassBases } from "./appearance-glass"

describe("alphaAt", () => {
  it("在 0、60、100 处分别返回 1、原值、原值 × 0.35", () => {
    expect(alphaAt(0.3, 0)).toBe(1)
    expect(alphaAt(0.3, 60)).toBe(0.3)
    expect(alphaAt(0.3, 100)).toBeCloseTo(0.105, 10)
  })

  it("带下限时不低于下限，g=0 仍为 1", () => {
    expect(alphaAt(0.78, 100, 0.6)).toBe(0.6)
    expect(alphaAt(0.78, 0, 0.6)).toBe(1)
  })

  it("对 g 单调不增", () => {
    for (const base of [0.07, 0.3, 0.62, 0.82]) {
      let last = Infinity
      for (let g = 0; g <= 100; g += 5) {
        const a = alphaAt(base, g)
        expect(a).toBeLessThanOrEqual(last)
        last = a
      }
    }
  })
})

describe("glassBases", () => {
  it("抄自 glass.css：浅色 bg 0.3、surface 0.62，深色 bg 0.14、surface 0.07", () => {
    const find = (tone: "light" | "dark", name: string) =>
      glassBases[tone].find((item) => item.name === name)?.alpha
    expect(find("light", "--bg")).toBe(0.3)
    expect(find("light", "--surface")).toBe(0.62)
    expect(find("dark", "--bg")).toBe(0.14)
    expect(find("dark", "--surface")).toBe(0.07)
    expect(find("light", "--popover")).toBe(0.78)
    expect(find("dark", "--popover-glass")).toBe(0.72)
  })
})
