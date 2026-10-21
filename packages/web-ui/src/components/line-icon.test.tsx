// 负责验证网页线性图标共用同一套描边样式、默认对读屏隐藏，以及 Google 图标的线性 G 画法。
// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react"
import { expect, it } from "vitest"
import { LineIcon } from "./line-icon"

it("renders every line icon with the shared stroke style", () => {
  for (const name of [
    "google",
    "github",
    "monitor",
    "swap",
    "arrow-left",
    "eye",
    "eye-off",
  ] as const) {
    const { container } = render(<LineIcon name={name} />)
    const svg = container.querySelector("svg")!
    expect(svg.getAttribute("viewBox")).toBe("0 0 24 24")
    expect(svg.getAttribute("stroke-width")).toBe("1.45")
    expect(svg.getAttribute("fill")).toBe("none")
    expect(svg.getAttribute("stroke")).toBe("currentColor")
    expect(svg.getAttribute("aria-hidden")).toBe("true")
    expect(svg.querySelector("path, circle, rect")).not.toBeNull()
    cleanup()
  }
})

it("draws Google as one open r=7 arc with a bar into the centre and no stub", () => {
  const { container } = render(<LineIcon name="google" />)
  const svg = container.querySelector("svg")!
  expect(svg.getAttribute("stroke-linecap")).toBe("round")
  const paths = container.querySelectorAll("path")
  expect(paths).toHaveLength(1)
  expect(paths[0].getAttribute("d")).toMatch(/^M[\d. ]+A7 7 0 1 0 19 12h-7$/)
  cleanup()
})
