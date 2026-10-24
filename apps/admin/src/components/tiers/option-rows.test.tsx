// 验证紧凑档位行的添加、推荐互斥、删除和服务端价格展示。
import { fireEvent, render, screen } from "@testing-library/react"
import { expect, it, vi } from "vitest"
import type { TierOption } from "@pigclaude/api/membership/types"
import { OptionRows } from "./option-rows"

const first = {
  months: "1",
  discountKind: "none" as const,
  value: "0",
  badge: "",
  recommended: false,
  enabled: true,
}
const second = { ...first, months: "3", recommended: true }
const price: TierOption = {
  id: "three",
  months: 3,
  discountKind: "none",
  discountValue: "0",
  badge: null,
  recommended: true,
  enabled: true,
  priceFen: "27000",
  perMonthFen: "9000",
  monthlyPurchaseFen: "30000",
  savedFen: "3000",
}

it("adds an option with the default draft", () => {
  const onChange = vi.fn()
  render(<OptionRows options={[]} disabled={false} onChange={onChange} />)
  fireEvent.click(screen.getByRole("button", { name: "添加档位" }))
  expect(onChange).toHaveBeenCalledWith([first])
})

it("keeps only one recommendation and shows the server price", () => {
  const onChange = vi.fn()
  render(
    <OptionRows options={[first, second]} prices={[price]} disabled={false} onChange={onChange} />,
  )
  fireEvent.click(screen.getByRole("button", { name: "推荐 1" }))
  expect(onChange).toHaveBeenCalledWith([
    { ...first, recommended: true },
    { ...second, recommended: false },
  ])
  expect(screen.getByText("现价 ¥270.00")).toBeTruthy()
  expect(screen.getByText("按月 ¥300.00")).toBeTruthy()
  expect(screen.getByText("省 ¥30.00")).toBeTruthy()
})

it("disables the discount value when there is no discount and removes a row", () => {
  const onChange = vi.fn()
  render(<OptionRows options={[first]} disabled={false} onChange={onChange} />)
  expect(screen.getByLabelText("优惠值 1").hasAttribute("disabled")).toBe(true)
  fireEvent.click(screen.getByRole("button", { name: "移除档位 1" }))
  expect(onChange).toHaveBeenCalledWith([])
})
