// 验证权益行的字数、移动、删除和上限提示。
import { fireEvent, render, screen } from "@testing-library/react"
import { expect, it, vi } from "vitest"
import { BenefitListEditor } from "./benefit-list-editor"

it("shows a unicode character count and keeps the first row fixed", () => {
  const onChange = vi.fn()
  render(<BenefitListEditor value={["桌面端无限使用"]} disabled={false} onChange={onChange} />)
  expect(screen.getByText("7/24")).toBeTruthy()
  expect(screen.getByRole("button", { name: "上移权益 1" }).hasAttribute("disabled")).toBe(true)
  fireEvent.click(screen.getByRole("button", { name: "删除权益 1" }))
  expect(onChange).toHaveBeenCalledWith([])
})

it("disables adding past eight benefits", () => {
  render(
    <BenefitListEditor
      value={Array.from({ length: 8 }, (_, i) => `权益 ${i}`)}
      disabled={false}
      onChange={vi.fn()}
    />,
  )
  expect(screen.getByRole("button", { name: "添加权益" }).hasAttribute("disabled")).toBe(true)
})
