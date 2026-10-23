// 验证用户端预览只展示用户能买到的档位，已下架的档位不出现。
import { render, screen, within } from "@testing-library/react"
import { expect, it } from "vitest"
import type { Tier } from "@pigclaude/api/membership/types"
import { TierPreview } from "./tier-preview"

const option: Tier["options"][number] = {
  id: "three",
  months: 3,
  discountKind: "none",
  discountValue: "0",
  badge: null,
  recommended: false,
  enabled: true,
  priceFen: "30000",
  perMonthFen: "10000",
  monthlyPurchaseFen: "30000",
  savedFen: "0",
}
const tier: Tier = {
  id: "vip",
  code: "vip",
  name: "VIP",
  level: 1,
  monthlyPriceFen: "10000",
  tagline: "",
  cardStyle: "azure",
  benefits: [],
  enabled: true,
  options: [option, { ...option, id: "six", months: 6, enabled: false, priceFen: "60000" }],
}

it("hides switched-off options from the user preview", () => {
  render(<TierPreview tier={tier} />)
  const preview = within(screen.getByRole("region", { name: "用户端预览" }))
  expect(preview.getByRole("radio", { name: /^3 个月/ })).toBeTruthy()
  expect(preview.queryByRole("radio", { name: /^6 个月/ })).toBeNull()
  expect(preview.getAllByRole("radio")).toHaveLength(1)
})
