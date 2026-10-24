// 负责展示当前会员权益及服务端购买报价，以账户、会话和路由隔离支付生命周期。
"use client"
import { Suspense, useState, type ReactNode } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { StaleSessionResponse } from "@pigclaude/api/client"
import { formatTime } from "@pigclaude/web-ui/lib/format"
import type { EntitlementResponse, PayType } from "@pigclaude/api/membership/types"
import { Toaster } from "@pigclaude/web-ui/components/sonner"
import { toast } from "sonner"
import { BenefitGrid } from "@pigclaude/web-ui/components/benefit-grid"
import {
  checkoutModel,
  defaultSelection,
  type PurchaseIntent,
} from "@/components/membership/checkout-model"
import { MembershipCards, remainingLabel } from "@/components/membership/membership-cards"
import { DurationPicker } from "@/components/membership/duration-picker"
import { CheckoutBar } from "@/components/membership/checkout-bar"
import { PurchaseHistory } from "@/components/membership/purchase-history"
import { MembershipSkeleton } from "@/components/membership/membership-skeleton"
import { RemainingUpgradeBanner } from "@/components/membership/remaining-upgrade-banner"
import { PayPanel, type PaySummary } from "@/components/membership/pay-panel"
import { QueryError, QueryLoading } from "@/components/query-state"
import { homeApi } from "@/lib/api"
import { homeSessionGeneration } from "@/lib/session-generation"

/** Suspense 包住读取 searchParams 的子树，满足 Next 生产预渲染要求。 */
export default function MembershipPage() {
  return (
    <Suspense
      fallback={
        <MembershipState>
          <QueryLoading label="正在读取会员信息…" />
        </MembershipState>
      }
    >
      <MembershipRoute />
    </Suspense>
  )
}
// 加载和错误状态与正文共用页面外壳，左右边缘和顶栏对齐。
function MembershipState({ children }: { children: ReactNode }) {
  return <main className="page-shell membership-page">{children}</main>
}
function MembershipRoute() {
  const pathname = usePathname()
  const params = useSearchParams()
  const me = useQuery({ queryKey: ["me"], queryFn: homeApi.user.me })
  if (me.isPending)
    return (
      <MembershipState>
        <QueryLoading label="正在读取账户…" />
      </MembershipState>
    )
  if (me.isError)
    return (
      <MembershipState>
        <QueryError error={me.error} onRetry={() => void me.refetch()} />
      </MembershipState>
    )
  const session = homeSessionGeneration.current()
  const orders = params.getAll("order")
  const orderNo = orders.length === 1 && /^PC[0-9A-Z]{20}$/.test(orders[0]) ? orders[0] : undefined
  return (
    <MembershipIdentity
      key={`${pathname}?${params.toString()}`}
      ownerId={me.data.id}
      session={session}
      orderNo={orderNo}
    />
  )
}
// 同一次回跳只归属初始账户；账户或会话改变后不把 URL 订单转交给新身份。
function MembershipIdentity({
  ownerId,
  session,
  orderNo,
}: {
  ownerId: string
  session: number
  orderNo?: string
}) {
  const identity = `${ownerId}:${session}`
  const [claim, setClaim] = useState({ identity, orderNo })
  if (claim.identity !== identity) {
    setClaim({ identity, orderNo: undefined })
    return null
  }
  return (
    <MembershipAccount key={identity} ownerId={ownerId} session={session} orderNo={claim.orderNo} />
  )
}
function MembershipAccount({
  ownerId,
  session,
  orderNo,
}: {
  ownerId: string
  session: number
  orderNo?: string
}) {
  const client = useQueryClient()
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [selection, setSelection] = useState<{ tier: string | null; option: string | null } | null>(
    null,
  )
  const [payType, setPayType] = useState<PayType | "">("")
  const [checkout, setCheckout] = useState<{
    id: number
    intent?: PurchaseIntent
    summary?: PaySummary
    payType?: PayType
    orderNo?: string
  } | null>(orderNo ? { id: 0, orderNo } : null)
  const [sequence, setSequence] = useState(0)
  const [glintSequence, setGlintSequence] = useState(0)
  const catalog = useQuery({
    queryKey: ["membership-catalog"],
    queryFn: homeApi.membership.catalog,
  })
  const quotes = useQuery({
    queryKey: ["membership-quotes", ownerId, session],
    queryFn: async ({ signal }) => {
      const result = await homeApi.membership.quotes()
      if (
        signal.aborted ||
        session !== homeSessionGeneration.current() ||
        client.getQueryData<{ id: string }>(["me"])?.id !== ownerId
      )
        throw new StaleSessionResponse()
      return result
    },
  })
  if (catalog.isPending || quotes.isPending) return <MembershipSkeleton />
  if (catalog.isError)
    return (
      <MembershipState>
        <QueryError error={catalog.error} onRetry={() => void catalog.refetch()} />
      </MembershipState>
    )
  if (quotes.isError)
    return (
      <MembershipState>
        <QueryError error={quotes.error} onRetry={() => void quotes.refetch()} />
      </MembershipState>
    )
  const entitlement = quotes.data.entitlement
  const active = entitlement.status === "active"
  const selected =
    selection ??
    defaultSelection(catalog.data, quotes.data, {
      tier: params.get("tier"),
      option: params.get("option"),
    })
  const model = checkoutModel(catalog.data, quotes.data, selected)
  const selectedCard = model.cards.find((card) => card.code === model.selectedTier)
  const hasAside = model.hasPurchasableOffers || model.remainingUpgrade !== null
  const channel =
    catalog.data.payTypes.find((type) => type === payType) ?? catalog.data.payTypes[0] ?? ""
  const choose = (intent: PurchaseIntent) => {
    const id = sequence + 1
    setSequence(id)
    const card = model.cards.find((item) => item.code === model.selectedTier)
    const remaining = "remainingUpgrade" in intent ? model.remainingUpgrade : null
    const option = model.options.find((item) => item.id === model.selectedOptionId)
    const offer = remaining ?? model.offer
    setCheckout({
      id,
      intent,
      payType: channel || undefined,
      summary:
        card && offer
          ? {
              tierName: card.name,
              cardStyle: card.cardStyle,
              title: remaining
                ? `${card.name} · 剩余 ${remainingLabel(remaining.remainingSeconds)}升级`
                : `${card.name} · ${option?.months ?? ""} 个月`,
              optionPriceFen: remaining ? null : (option?.priceFen ?? null),
              creditFen: offer.creditFen,
              payableFen: offer.payableFen,
              bonusSeconds: remaining ? "0" : (model.offer?.bonusSeconds ?? "0"),
            }
          : undefined,
    })
  }
  return (
    <main className="page-shell membership-page">
      <Toaster />
      <header className="membership-head">
        <h1 className="page-title">会员</h1>
        <p className="membership-sub">选择等级和时长，扫码即可开通、续费或升级。</p>
        {!active && <p className="membership-hint">开通会员后即可在桌面端使用 PigClaude</p>}
      </header>
      <div className="membership-layout" data-aside={hasAside}>
        <div className="membership-main">
          <MembershipCards
            cards={model.cards}
            entitlement={entitlement}
            glintSequence={glintSequence}
            selected={model.selectedTier}
            onSelect={(tier) => setSelection(defaultSelection(catalog.data, quotes.data, { tier }))}
          />
          {model.hasPurchasableOffers && (
            <DurationPicker
              options={model.options}
              selected={model.selectedOptionId}
              onSelect={(option) => setSelection({ ...selected, option })}
            />
          )}
          {selectedCard && selectedCard.benefits.length > 0 && (
            <section className="membership-section" aria-labelledby="membership-benefits">
              <div className="membership-section-head">
                <h2 id="membership-benefits">{selectedCard.name} 权益</h2>
              </div>
              <BenefitGrid items={selectedCard.benefits} />
            </section>
          )}
        </div>
        <div className="membership-aside">
          {model.hasPurchasableOffers && (
            <CheckoutBar
              model={model}
              payTypes={catalog.data.payTypes}
              payType={channel}
              onPayType={setPayType}
              onChoose={() => {
                if (model.cta.intent) choose(model.cta.intent)
              }}
            />
          )}
          <RemainingUpgradeBanner
            offer={model.remainingUpgrade}
            disabled={!catalog.data.payTypes.length}
            onChoose={() => {
              if (model.remainingUpgrade)
                choose({ remainingUpgrade: { tierCode: model.remainingUpgrade.tierCode } })
            }}
          />
        </div>
        <div className="membership-history">
          <PurchaseHistory ownerId={ownerId} session={session} />
        </div>
      </div>
      {checkout && (
        <PayPanel
          key={checkout.id}
          ownerId={ownerId}
          intent={checkout.intent}
          payType={checkout.payType ?? "alipay"}
          summary={checkout.summary}
          onActivated={() => {
            setGlintSequence((value) => value + 1)
            const current = client.getQueryData<EntitlementResponse>(["entitlement"])
            const name =
              current?.tier?.name ?? entitlement.tier?.name ?? checkout.summary?.tierName ?? "会员"
            const until = current?.validUntil ? formatTime(current.validUntil).slice(0, 10) : null
            toast.success(until ? `${name} 已生效，有效期至 ${until}` : `${name} 已生效`)
          }}
          payTypes={catalog.data.payTypes}
          orderNo={checkout.orderNo}
          onClose={() => {
            setCheckout(null)
            // 网关回跳单处理完就从地址栏去掉 ?order=，刷新页面不会再打开这笔旧订单；其他参数保留。
            if (checkout.orderNo) {
              const rest = new URLSearchParams(params.toString())
              rest.delete("order")
              router.replace(rest.size ? `${pathname}?${rest}` : pathname)
            }
          }}
        />
      )}
    </main>
  )
}
