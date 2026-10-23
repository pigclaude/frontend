// 将服务端目录与报价投影为会员结算展示，不进行金额计算。
import type {
  Catalog,
  CatalogOption,
  CardStyle,
  Offer,
  Quotes,
  RemainingUpgrade,
} from "@pigclaude/api/membership/types"
/** 下单意图不包含客户端金额。 */
export type PurchaseIntent = { optionId: string } | { remainingUpgrade: { tierCode: string } }
/** 卡面保留目录或退市等级快照。 */
export interface CardModel {
  code: string
  name: string
  level: number
  cardStyle: CardStyle
  tagline: string
  benefits: string[]
  monthlyPriceFen: string | null
  role: "current" | "current-retired" | "purchasable" | "blocked"
  blockedReason: string | null
}
/** 结算按钮的可用性及服务端意图。 */
export interface CtaModel {
  label: string
  disabled: boolean
  intent: PurchaseIntent | null
}
/** 一次选择对应的完整结算视图。 */
export interface CheckoutModel {
  cards: CardModel[]
  hasPurchasableOffers: boolean
  selectedTier: string | null
  options: CatalogOption[]
  selectedOptionId: string | null
  offer: Offer | null
  cta: CtaModel
  remainingUpgrade: (RemainingUpgrade & { tierName: string }) | null
}
function buildCards(catalog: Catalog, quotes: Quotes): CardModel[] {
  const current = quotes.entitlement.status === "active" ? quotes.entitlement.tier : null
  const result = catalog.tiers
    .toSorted((a, b) => a.level - b.level)
    .map((tier): CardModel => {
      const tierOffers = tier.options.map((option) =>
        quotes.offers.find((offer) => offer.optionId === option.id),
      )
      const blocked = tierOffers.length > 0 && tierOffers.every((offer) => !!offer?.blocked)
      return {
        ...tier,
        role: current?.code === tier.code ? "current" : blocked ? "blocked" : "purchasable",
        blockedReason: blocked
          ? `你已是 ${current?.name ?? "更高等级会员"}，无需购买 ${tier.name}`
          : null,
      }
    })
  return quotes.currentTier
    ? [
        {
          ...quotes.currentTier,
          role: "current-retired",
          monthlyPriceFen: null,
          blockedReason: null,
        },
        ...result,
      ]
    : result
}
/** 有效 URL 选择优先，其次当前在售等级和推荐档位。 */
export function defaultSelection(
  catalog: Catalog,
  quotes: Quotes,
  initial?: { tier?: string | null; option?: string | null },
): { tier: string | null; option: string | null } {
  const selectable = buildCards(catalog, quotes).filter(
    (card) => card.role === "current" || card.role === "purchasable",
  )
  const tier =
    selectable.find((card) => card.code === initial?.tier) ??
    selectable.find((card) => card.role === "current") ??
    selectable[0]
  const options = catalog.tiers.find((item) => item.code === tier?.code)?.options ?? []
  const option =
    options.find((item) => item.id === initial?.option) ??
    options.find((item) => item.recommended) ??
    options[0]
  return { tier: tier?.code ?? null, option: option?.id ?? null }
}
/** 结算金额直接引用本人报价，剩余升级只对选中等级提供。 */
export function checkoutModel(
  catalog: Catalog,
  quotes: Quotes,
  selection: { tier: string | null; option: string | null },
): CheckoutModel {
  const cards = buildCards(catalog, quotes)
  const card = cards.find((item) => item.code === selection.tier)
  const options = catalog.tiers.find((item) => item.code === selection.tier)?.options ?? []
  const option = options.find((item) => item.id === selection.option)
  const offer = quotes.offers.find((item) => item.optionId === option?.id) ?? null
  const disabled =
    !catalog.payTypes.length ||
    !offer ||
    !!offer.blocked ||
    card?.role === "blocked" ||
    card?.role === "current-retired"
  let label = "立即开通"
  if (!catalog.payTypes.length) label = "在线支付暂未开放"
  else if (!offer) label = "暂不可购买"
  else if (offer.blocked) label = card?.blockedReason ?? "暂不可购买"
  else if (offer.kind === "upgrade_package")
    label = offer.payableFen === "0" ? "免费升级" : "立即升级"
  else if (card?.role === "current") label = "立即续费"
  return {
    cards,
    hasPurchasableOffers: catalog.tiers.some((tier) =>
      tier.options.some((option) =>
        quotes.offers.some((offer) => offer.optionId === option.id && !offer.blocked),
      ),
    ),
    selectedTier: selection.tier,
    options,
    selectedOptionId: option?.id ?? null,
    offer,
    cta: { label, disabled, intent: !disabled && option ? { optionId: option.id } : null },
    remainingUpgrade:
      quotes.remainingUpgrade?.tierCode === selection.tier && card
        ? { ...quotes.remainingUpgrade, tierName: card.name }
        : null,
  }
}
