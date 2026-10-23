// 负责会员等级、权益、报价与管理员操作的服务端 DTO；金额保持十进制字符串。
/** 会员卡面使用固定预设。 */
export type CardStyle = "azure" | "gold" | "obsidian" | "violet" | "emerald" | "rose"
/** 公开等级标识不包含内部数据库 ID。 */
export interface TierRef {
  code: string
  name: string
  level: number
  cardStyle: CardStyle
}
/** 权益状态含从未开通，与撤销和过期严格区分。 */
export type MembershipStatus = "none" | "active" | "expired" | "revoked"
/** 网站和桌面共用的权益响应。 */
export interface EntitlementResponse {
  status: MembershipStatus
  tier: TierRef | null
  validUntil: string | null
  remainingSeconds: string
  entitlementVersion: string
}
/** 档位折扣只提交整数表达，不在客户端计算价格。 */
export interface OptionInput {
  id?: string
  months: number
  discountKind: "none" | "amount" | "percent"
  discountValue: string
  badge: string | null
  recommended: boolean
  enabled: boolean
}
/** 创建和预览要求 code；更新客户端按已有 ID 省略 code。 */
export interface TierInput {
  code?: string
  name: string
  level: number
  monthlyPriceFen: string
  cardStyle: CardStyle
  tagline: string
  benefits: string[]
  enabled: boolean
  options: OptionInput[]
}
/** 管理档位的所有展示金额由服务端返回。 */
export interface TierOption extends OptionInput {
  perMonthFen: string
  id: string
  priceFen: string
  monthlyPurchaseFen: string
  savedFen: string
}
/** 管理等级及服务端定价结果。 */
export interface Tier extends TierInput {
  id: string
  code: string
  activeMemberCount?: number
  options: TierOption[]
}
/** 用户目录档位含服务端优惠和单月价格。 */
export interface CatalogOption {
  id: string
  months: number
  priceFen: string
  monthlyPurchaseFen: string
  savedFen: string
  perMonthFen: string
  badge: string | null
  recommended: boolean
}
/** 用户公开等级目录。 */
export interface CatalogTier extends TierRef {
  tagline: string
  benefits: string[]
  monthlyPriceFen: string
  options: CatalogOption[]
}
/** 易支付支持的付费渠道。 */
export type PayType = "alipay" | "wxpay"
/** 公开目录不要求登录。 */
export interface Catalog {
  tiers: CatalogTier[]
  payTypes: PayType[]
}
/** 冻结订单种类。 */
export type OrderKind = "purchase" | "upgrade_package" | "upgrade_remaining"
/** 本人档位报价，blocked 非空时不可购买。 */
export interface Offer {
  optionId: string
  kind: OrderKind
  payableFen: string
  creditFen: string
  bonusSeconds: string
  blocked: string | null
}
/** 剩余有效期升级报价。 */
export interface RemainingUpgrade {
  tierCode: string
  remainingSeconds: string
  payableFen: string
  creditFen: string
}
/** 当前等级展示文案由服务端返回。 */
export interface CurrentTier extends TierRef {
  tagline: string
  benefits: string[]
}
/** 本人报价与权益同次返回。 */
export interface Quotes {
  entitlement: EntitlementResponse
  offers: Offer[]
  remainingUpgrade: RemainingUpgrade | null
  currentTier: CurrentTier | null
}
/** 建单只发送意图，不允许客户端金额。 */
export type CreateOrderInput = { payType: PayType } & (
  | { optionId: string; remainingUpgrade?: never }
  | { remainingUpgrade: { tierCode: string }; optionId?: never }
)
/** 二维码内容与图片 URL 分别保留，图片不作为二维码内容。 */
export type Payment =
  | { kind: "qr"; qrcode: string; imageUrl: string | null }
  | { kind: "redirect"; url: string }
  | { kind: "free" }
/** 本人订单明细来自服务端冻结字段，不在浏览器重新定价。 */
export interface OrderPresentation {
  tier: TierRef
  purpose: OrderPurpose
  months: number | null
  durationSeconds: string
  optionPriceFen: string
  creditFen: string
  bonusSeconds: string
}
/** 建单响应仅包含服务端实付、明细与支付载体。 */
export interface CreatedOrder {
  presentation: OrderPresentation
  orderNo: string
  payableFen: string
  expiresAt: string
  payment: Payment
}
/** 订单状态。 */
export type OrderStatus = "pending" | "activated" | "needs_review" | "expired" | "closed"
/** 本人订单查询不暴露管理员字段。 */
export interface HomeOrder {
  presentation: OrderPresentation
  orderNo: string
  status: OrderStatus
  payableFen: string
  expiresAt: string
}
/** 会员行包含当前邮箱和等级摘要。 */
export interface MembershipItem {
  userId: string
  email: string
  tier: TierRef
  status: MembershipStatus
  validUntil: string
  entitlementVersion: string
}
/** 会员列表按用户、状态和等级筛选。 */
export type ListMembershipsQuery = {
  q?: string
  status?: MembershipStatus | ""
  tierId?: string
  cursor?: string
  limit?: number
}
/** null 游标表示末页。 */
export interface ListMembershipsResponse {
  items: MembershipItem[]
  nextCursor: string | null
}
/** 用户选择器返回服务器生效状态。 */
export interface UserPick {
  userId: string
  email: string
  tier: TierRef | null
  validUntil: string | null
  status: MembershipStatus
}
/** 人工授予输入只接受整数时长与分金额。 */
export interface GrantInput {
  userId: string
  tierId: string
  durationUnit: "month" | "day"
  duration: string
  valueFen: string
  remark: string
}
/** 授予预览的价值与秒数由服务端计算。 */
export interface GrantPreview {
  tier: TierRef
  validUntil: string
  voidedRemainingSeconds: string
  voidedValueFen: string
  convertedSeconds: string
}
/** 撤销必须有明确原因。 */
export interface RevokeInput {
  userId: string
  reason: string
}
/** 后台订单筛选原样交给服务端，不解释游标。 */
export type AdminOrdersQuery = {
  status?: OrderStatus
  q?: string
  tierId?: string
  from?: string
  to?: string
  needsReview?: boolean
  cursor?: string
  limit?: number
}
/** 管理员订单冻结快照，未支付金额保留 null。 */
export interface AdminOrder {
  orderNo: string
  userId: string
  email: string
  kind: OrderKind
  tierName: string
  tierCode: string
  cardStyle: CardStyle
  purpose: OrderPurpose
  optionPriceFen: string
  paidAt: string | null
  expiresAt: string
  months: number | null
  listPriceFen: string
  creditFen: string
  payableFen: string
  paidFen: string | null
  payType: PayType | "free"
  gatewayTradeNo: string | null
  status: OrderStatus
  creditShortfallFen: string
  createdAt: string
  activatedAt: string | null
}
/** payment:read 独立提供历史等级筛选元数据。 */
export interface AdminOrders {
  items: AdminOrder[]
  nextCursor: string | null
  filterTiers: { id: string; name: string; cardStyle: CardStyle }[]
}

/** 订单目的由服务端冻结。 */
export type OrderPurpose = "open" | "renew" | "upgrade" | "upgrade_remaining"
/** 本人历史订单仅展示本人可见快照。 */
export interface HomeOrderItem {
  orderNo: string
  tier: TierRef
  purpose: OrderPurpose
  months: number | null
  payableFen: string
  paidFen: string | null
  payType: PayType | "free"
  status: OrderStatus
  createdAt: string
  activatedAt: string | null
}
/** 本人历史订单使用服务端游标。 */
export interface HomeOrderPage {
  items: HomeOrderItem[]
  nextCursor: string | null
}
/** 后台统计金额和待处理并集均由服务端计算。 */
export interface AdminOrdersSummary {
  todayPaidFen: string
  monthPaidFen: string
  monthActivatedCount: number
  needsReviewCount: number
  pendingCount: number
}
