// 负责验证主题色选择器、跨实例订阅、HEX 校验和键盘交互。
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { AccentPicker } from "./accent-picker"
import { readAccent, resetAccent } from "../lib/accent"
beforeEach(() => {
  resetAccent()
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
function open() {
  fireEvent.click(screen.getAllByRole("button", { name: "主题色" })[0])
}
describe("accent picker", () => {
  it("picker lists 8 presets and applies on click", () => {
    render(<AccentPicker />)
    open()
    expect(screen.getAllByRole("radio")).toHaveLength(8)
    fireEvent.click(screen.getByRole("radio", { name: "猪鼻粉" }))
    expect(screen.getByRole("radio", { name: "猪鼻粉" }).getAttribute("aria-checked")).toBe("true")
    expect(readAccent()).toEqual({ kind: "preset", id: "rose" })
  })
  it("custom hex input applies valid color only", () => {
    render(<AccentPicker />)
    open()
    const input = screen.getByRole("textbox", { name: "HEX" })
    fireEvent.change(input, { target: { value: "#12ab34" } })
    expect(readAccent()).toEqual({ kind: "custom", hex: "#12ab34" })
    fireEvent.change(input, { target: { value: "12ab3" } })
    expect(readAccent()).toEqual({ kind: "custom", hex: "#12ab34" })
    expect(screen.getByText("请输入 #RRGGBB")).toBeTruthy()
    expect(input.getAttribute("aria-invalid")).toBe("true")
  })
  it("reset restores default and syncs multiple mounted pickers", () => {
    render(
      <>
        <AccentPicker />
        <AccentPicker />
      </>,
    )
    open()
    fireEvent.click(screen.getByRole("radio", { name: "猪鼻粉" }))
    for (const trigger of screen.getAllByRole("button", { name: "主题色" }))
      expect(trigger.getAttribute("data-accent")).toBe("rose")
    fireEvent.click(screen.getByRole("button", { name: "恢复默认" }))
    expect(readAccent()).toEqual({ kind: "preset", id: "indigo" })
    expect(screen.getByRole("radio", { name: "靛紫" }).getAttribute("aria-checked")).toBe("true")
  })
  it("supports radio arrow keys and slider keyboard semantics", async () => {
    render(<AccentPicker />)
    open()
    const group = screen.getByRole("radiogroup")
    const indigo = within(group).getByRole("radio", { name: "靛紫" })
    indigo.focus()
    fireEvent.keyDown(indigo, { key: "ArrowRight" })
    await waitFor(() => expect(readAccent()).toEqual({ kind: "preset", id: "blue" }))
    const hue = screen.getByRole("slider", { name: "色相" })
    const before = hue.getAttribute("aria-valuenow")
    fireEvent.keyDown(hue, { key: "ArrowRight" })
    expect(hue.getAttribute("aria-valuenow")).not.toBe(before)
    expect(
      document.querySelectorAll('input[type="color"], input[type="range"], select'),
    ).toHaveLength(0)
  })
})
