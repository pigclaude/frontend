// 负责提供会员页面和真实支付弹窗测试的服务端报价样例。
import type { Catalog, Quotes, CreatedOrder } from "@pigclaude/api/membership/types"
/** 公开目录保留服务端计算的价格字段。 */
export const catalog: Catalog = {
  payTypes: ["alipay", "wxpay"],
  tiers: [
    {
      code: "vip",
      name: "VIP",
      level: 1,
      monthlyPriceFen: "1000",
      description: "基础权益",
      options: [
        {
          id: "vip-3",
          months: 3,
          priceFen: "2500",
          monthlyPurchaseFen: "3000",
          savedFen: "500",
          perMonthFen: "833",
        },
      ],
    },
    {
      code: "svip",
      name: "SVIP",
      level: 2,
      monthlyPriceFen: "2000",
      description: "高级权益",
      options: [
        {
          id: "svip-3",
          months: 3,
          priceFen: "5000",
          monthlyPurchaseFen: "6000",
          savedFen: "1000",
          perMonthFen: "1667",
        },
      ],
    },
  ],
}
/** 登录报价包含抵扣、赠时及剩余时间升级。 */
export const quotes: Quotes = {
  entitlement: {
    status: "active",
    tier: { code: "vip", name: "VIP", level: 1 },
    validUntil: "2026-12-01T00:00:00Z",
    remainingSeconds: "864000",
    entitlementVersion: "2",
  },
  offers: [
    {
      optionId: "vip-3",
      kind: "purchase",
      payableFen: "2500",
      creditFen: "0",
      bonusSeconds: "0",
      blocked: null,
    },
    {
      optionId: "svip-3",
      kind: "upgrade_package",
      payableFen: "4000",
      creditFen: "1000",
      bonusSeconds: "172800",
      blocked: null,
    },
  ],
  remainingUpgrade: {
    tierCode: "svip",
    remainingSeconds: "864000",
    payableFen: "1000",
    creditFen: "1000",
  },
}
/** 建单响应只由服务端提供订单和应付金额。 */
export const created: CreatedOrder = {
  orderNo: "PC12345678901234567890",
  payableFen: "4000",
  expiresAt: "2026-12-01T00:15:00Z",
  payment: { kind: "qr", qrcode: "https://pay.example/qr", imageUrl: null },
}
