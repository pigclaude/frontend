// 负责验证成熟套餐卡片使用分金额格式化并保留真实空状态。
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import type { CatalogTier } from "@pigclaude/api/membership/types"
import { PlanCards } from "@/components/membership/plan-cards"

afterEach(cleanup)

describe("membership plan display", () => {
  it("formats exact integer fen amounts as yuan", () => {
    const plan: CatalogTier = {
      code: "vip",
      name: "VIP",
      level: 1,
      monthlyPriceFen: "1234",
      description: "桌面设备授权",
      options: [],
    }
    render(<PlanCards plans={[plan]} />)
    expect(screen.getByText("按月购买 ¥12.34")).toBeTruthy()
    expect(screen.queryByText("1234 分")).toBeNull()
    expect(screen.queryByRole("button", { name: /购买/ })).toBeNull()
  })
  it("shows the catalog empty state", () => {
    render(<PlanCards plans={[]} />)
    expect(screen.getByText("暂无可用套餐")).toBeTruthy()
  })
})
