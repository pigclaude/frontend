// 负责验证成熟套餐卡片使用分金额格式化并保留真实空状态。
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import type { PlanItem } from "@pigclaude/api/home/types"
import { PlanCards } from "@/components/membership/plan-cards"

afterEach(cleanup)

describe("membership plan display", () => {
  it("formats exact integer fen amounts as yuan", () => {
    const plan: PlanItem = {
      id: "plan-1",
      name: "天卡",
      productCode: "pigclaude",
      planKind: "day",
      priceFen: "1234",
      originalPriceFen: "1234",
      durationDays: "1",
      lifetime: false,
      description: "桌面设备授权",
      termsVersion: "1",
      termsText: "会员条款",
    }
    render(<PlanCards plans={[plan]} />)
    expect(screen.getByText("¥12.34")).toBeTruthy()
    expect(screen.queryByText("1234 分")).toBeNull()
    expect(screen.queryByRole("button", { name: /购买/ })).toBeNull()
  })
  it("shows the catalog empty state", () => {
    render(<PlanCards plans={[]} />)
    expect(screen.getByText("暂无可用套餐")).toBeTruthy()
  })
})
