// 负责验证自绘交通灯只在没有 macOS 原生交通灯时渲染。
import { describe, expect, it } from "vitest"
import { shouldRenderCustomTraffic } from "./traffic-lights"

describe("shouldRenderCustomTraffic", () => {
  it("hides custom traffic lights on macOS and keeps them elsewhere", () => {
    expect(shouldRenderCustomTraffic("darwin")).toBe(false)
    expect(shouldRenderCustomTraffic("win32")).toBe(true)
    expect(shouldRenderCustomTraffic("linux")).toBe(true)
    expect(shouldRenderCustomTraffic(undefined)).toBe(true)
  })
})
