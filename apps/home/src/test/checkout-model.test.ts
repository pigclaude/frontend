// 验证结算模型只选择服务端档位并保留会员语义。
import { expect, it } from "vitest"
import { checkoutModel, defaultSelection } from "@/components/membership/checkout-model"
import { catalog, quotes } from "./membership-fixtures"
it("new member defaults to lowest tier and opens", () => {
  const q = {
    ...quotes,
    entitlement: { ...quotes.entitlement, status: "none" as const, tier: null },
  }
  const selected = defaultSelection(catalog, q)
  expect(selected.tier).toBe("vip")
  expect(checkoutModel(catalog, q, selected).cta.label).toBe("立即开通")
})
it("active vip defaults to vip renewal", () =>
  expect(checkoutModel(catalog, quotes, defaultSelection(catalog, quotes)).cta.label).toBe(
    "立即续费",
  ))
it("selecting svip as vip upgrades with credit", () => {
  const m = checkoutModel(catalog, quotes, { tier: "svip", option: "svip-3" })
  expect(m.cta.label).toBe("立即升级")
  expect(m.offer?.creditFen).toBe("1000")
})
it("zero payable upgrade is free", () =>
  expect(
    checkoutModel(
      catalog,
      { ...quotes, offers: [{ ...quotes.offers[1], payableFen: "0" }] },
      { tier: "svip", option: "svip-3" },
    ).cta.label,
  ).toBe("免费升级"))
it("active svip blocks vip with reason", () => {
  const q = {
    ...quotes,
    entitlement: { ...quotes.entitlement, tier: catalog.tiers[1] },
    offers: [{ ...quotes.offers[0], blocked: "LOWER_TIER" }],
  }
  const card = checkoutModel(catalog, q, { tier: "svip", option: "svip-3" }).cards[0]
  expect(card.role).toBe("blocked")
  expect(card.blockedReason).toBe("你已是 SVIP，无需购买 VIP")
})
it("recommended option is default", () => {
  const c = {
    ...catalog,
    tiers: [
      {
        ...catalog.tiers[1],
        options: [
          { ...catalog.tiers[1].options[0], id: "svip-1" },
          { ...catalog.tiers[1].options[0], recommended: true },
        ],
      },
    ],
  }
  expect(defaultSelection(c, quotes).option).toBe("svip-3")
})
it("retired current tier keeps card and selects first purchasable", () => {
  const c = { ...catalog, tiers: [catalog.tiers[1]] }
  const q = { ...quotes, currentTier: catalog.tiers[0] }
  const m = checkoutModel(c, q, defaultSelection(c, q))
  expect(m.cards[0].role).toBe("current-retired")
  expect(m.selectedTier).toBe("svip")
  expect(m.cta.label).toBe("立即升级")
})
it("initial params apply only when valid", () => {
  expect(defaultSelection(catalog, quotes, { tier: "svip", option: "svip-3" })).toEqual({
    tier: "svip",
    option: "svip-3",
  })
  expect(defaultSelection(catalog, quotes, { tier: "nope", option: "x" })).toEqual({
    tier: "vip",
    option: "vip-3",
  })
})
it("no pay types disables checkout", () => {
  const m = checkoutModel({ ...catalog, payTypes: [] }, quotes, { tier: "vip", option: "vip-3" })
  expect(m.cta.disabled).toBe(true)
  expect(m.cta.label).toBe("在线支付暂未开放")
})
it("remaining upgrade only on its tier", () => {
  expect(
    checkoutModel(catalog, quotes, { tier: "vip", option: "vip-3" }).remainingUpgrade,
  ).toBeNull()
  expect(
    checkoutModel(catalog, quotes, { tier: "svip", option: "svip-3" }).remainingUpgrade,
  ).not.toBeNull()
})
