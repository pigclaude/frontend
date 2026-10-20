// 负责验证网页线性图标共用同一套描边样式并默认对读屏隐藏。
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
