// 验证会员卡片的展示、禁用和键盘选择合同。
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { MembershipCard, MembershipCardGroup } from "./membership-card"
import { TierBadge } from "./tier-badge"
import { BenefitGrid } from "./benefit-grid"
afterEach(cleanup)
it("selectable card is a radio with checked state", () => {
  const select = vi.fn()
  const { rerender } = render(
    <MembershipCard name="VIP" cardStyle="azure" selected onSelect={select} />,
  )
  expect(screen.getByRole("radio").getAttribute("aria-checked")).toBe("true")
  fireEvent.click(screen.getByRole("radio"))
  expect(select).toHaveBeenCalledOnce()
  rerender(<MembershipCard name="VIP" cardStyle="azure" onSelect={select} />)
  expect(screen.getByRole("radio").getAttribute("aria-checked")).toBe("false")
})
it("disabled card does not select", () => {
  const select = vi.fn()
  render(<MembershipCard name="VIP" cardStyle="azure" disabled onSelect={select} />)
  const radio = screen.getByRole("radio")
  expect(radio.getAttribute("aria-disabled")).toBe("true")
  fireEvent.click(radio)
  fireEvent.keyDown(radio, { key: " " })
  expect(select).not.toHaveBeenCalled()
})
it("group arrow keys move selection and wrap past disabled cards", () => {
  const select = vi.fn()
  render(
    <MembershipCardGroup label="会员等级">
      <MembershipCard name="VIP" cardStyle="azure" selected onSelect={() => {}} />
      <MembershipCard name="停用" cardStyle="rose" disabled onSelect={() => {}} />
      <MembershipCard name="SVIP" cardStyle="gold" onSelect={select} />
    </MembershipCardGroup>,
  )
  const radios = screen.getAllByRole("radio")
  expect(radios.map((radio) => radio.tabIndex)).toEqual([0, -1, -1])
  fireEvent.keyDown(radios[0], { key: "ArrowRight" })
  expect(select).toHaveBeenCalledOnce()
  expect(document.activeElement).toBe(radios[2])
  fireEvent.keyDown(radios[2], { key: "ArrowRight" })
  expect(document.activeElement).toBe(radios[0])
  fireEvent.keyDown(radios[0], { key: "ArrowLeft" })
  expect(document.activeElement).toBe(radios[2])
})
it("card carries style attribute and optional content without radio semantics", () => {
  render(
    <MembershipCard
      name="SVIP"
      cardStyle="gold"
      size="sm"
      eyebrow="当前等级"
      tagline="进阶之选"
      price="价格"
      footer="底部"
      glint
      dimmed
    />,
  )
  const card = screen.getByText("SVIP").closest(".membership-card")
  expect(card?.getAttribute("data-style")).toBe("gold")
  expect(card?.getAttribute("data-glint")).toBe("true")
  expect(screen.queryByRole("radio")).toBeNull()
  for (const text of ["当前等级", "进阶之选", "价格", "底部"])
    expect(screen.getByText(text)).toBeTruthy()
})
it("badge carries its preset and benefits disappear when empty", () => {
  const { rerender } = render(
    <>
      <TierBadge name="SVIP" cardStyle="gold" />
      <BenefitGrid items={[]} />
    </>,
  )
  expect(screen.getByText("SVIP").getAttribute("data-style")).toBe("gold")
  expect(screen.queryByRole("list")).toBeNull()
  rerender(<BenefitGrid items={["高级模型", "专属服务"]} />)
  expect(screen.getAllByRole("listitem")).toHaveLength(2)
})
