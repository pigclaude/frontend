// 验证紧凑等级卡的等宽网格、禁用原因和键盘切换。
import { fireEvent, render, screen } from "@testing-library/react"
import { expect, it, vi } from "vitest"
import type { Tier } from "@pigclaude/api/membership/types"
import { TierChoiceCards } from "./tier-choice-cards"

const vip: Tier = {
  id: "vip",
  code: "vip",
  name: "VIP",
  level: 1,
  cardStyle: "azure",
  monthlyPriceFen: "100",
  tagline: "入门",
  benefits: [],
  enabled: true,
  options: [],
}
const svip: Tier = { ...vip, id: "svip", code: "svip", name: "SVIP", level: 2, cardStyle: "gold" }

it("renders equal-height cards in a two-column grid", () => {
  render(
    <TierChoiceCards
      tiers={[vip, svip]}
      value={null}
      onChange={vi.fn()}
      disabledReason={() => null}
    />,
  )
  const radios = screen.getAllByRole("radio")
  expect(radios).toHaveLength(2)
  expect(radios[0].className).toContain("min-h-[104px]")
  expect(radios[0].parentElement?.className).toContain("sm:grid-cols-2")
})

it("skips disabled cards and selects the next enabled card with the keyboard", () => {
  const onChange = vi.fn()
  render(
    <TierChoiceCards
      tiers={[vip, svip]}
      value={null}
      onChange={onChange}
      disabledReason={(tier) => (tier.id === "svip" ? "当前不可操作" : null)}
    />,
  )
  const first = screen.getByRole("radio", { name: /^VIP/ })
  first.focus()
  fireEvent.keyDown(first, { key: "ArrowRight" })
  expect(onChange).toHaveBeenCalledWith("vip")
  expect(screen.getByRole("radio", { name: /^SVIP/ }).hasAttribute("disabled")).toBe(true)
})
