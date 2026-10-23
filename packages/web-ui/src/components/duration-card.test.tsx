// 验证时长卡只展示服务端金额，并支持完整单选键盘交互。
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { DurationCard, DurationCardGroup } from "./duration-card"
afterEach(cleanup)
const prices = {
  months: 3,
  priceFen: "13500",
  perMonthFen: "4500",
  savedFen: "1200",
  selected: false,
}
it("renders server prices verbatim", () => {
  render(<DurationCard {...prices} badge="最受欢迎" />)
  for (const text of ["3 个月", "¥135.00", "¥45.00/月", "省 ¥12.00", "最受欢迎"])
    expect(screen.getByText(text)).toBeTruthy()
})
it("hides saving when zero and preserves large integer precision", () => {
  render(<DurationCard {...prices} savedFen="0" priceFen="9007199254740993" />)
  expect(screen.queryByText(/^省/)).toBeNull()
  expect(screen.getByText("¥90,071,992,547,409.93")).toBeTruthy()
})
it("duration group skips disabled radios and selects with arrows", () => {
  const select = vi.fn()
  render(
    <DurationCardGroup label="购买时长">
      <DurationCard {...prices} selected onSelect={() => {}} />
      <DurationCard {...prices} months={6} disabled onSelect={select} />
      <DurationCard {...prices} months={12} onSelect={select} />
    </DurationCardGroup>,
  )
  const radios = screen.getAllByRole("radio")
  expect(radios.map((radio) => radio.tabIndex)).toEqual([0, -1, -1])
  fireEvent.click(radios[1])
  expect(select).not.toHaveBeenCalled()
  fireEvent.keyDown(radios[0], { key: "ArrowRight" })
  expect(select).toHaveBeenCalledOnce()
  expect(document.activeElement).toBe(radios[2])
})
