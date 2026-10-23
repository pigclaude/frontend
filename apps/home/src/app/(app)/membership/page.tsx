// 负责展示当前会员权益及服务端购买报价，以账户、会话和路由隔离支付生命周期。
"use client"
import { Suspense, useState } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { StaleSessionResponse } from "@pigclaude/api/client"
import { formatDurationSeconds, formatTime } from "@pigclaude/web-ui/lib/format"
import type { PayType } from "@pigclaude/api/membership/types"
import { BenefitGrid } from "@pigclaude/web-ui/components/benefit-grid"
import {
  checkoutModel,
  defaultSelection,
  type PurchaseIntent,
} from "@/components/membership/checkout-model"
import { MembershipCards } from "@/components/membership/membership-cards"
import { DurationPicker } from "@/components/membership/duration-picker"
import { CheckoutBar } from "@/components/membership/checkout-bar"
import { PurchaseHistory } from "@/components/membership/purchase-history"
import { MembershipSkeleton } from "@/components/membership/membership-skeleton"
import { RemainingUpgradeBanner } from "@/components/membership/remaining-upgrade-banner"
import { PayDialog } from "@/components/membership/pay-dialog"
import { QueryError, QueryLoading } from "@/components/query-state"
import { homeApi } from "@/lib/api"
import { homeSessionGeneration } from "@/lib/session-generation"

/** Suspense 包住读取 searchParams 的子树，满足 Next 生产预渲染要求。 */
export default function MembershipPage() {
  return (
    <Suspense fallback={<QueryLoading label="正在读取会员信息…" />}>
      <MembershipRoute />
    </Suspense>
  )
}
function MembershipRoute() {
  const pathname = usePathname()
  const params = useSearchParams()
  const me = useQuery({ queryKey: ["me"], queryFn: homeApi.user.me })
  if (me.isPending) return <QueryLoading label="正在读取账户…" />
  if (me.isError) return <QueryError error={me.error} onRetry={() => void me.refetch()} />
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
  const params = useSearchParams()
  const [selection, setSelection] = useState<{ tier: string | null; option: string | null } | null>(
    null,
  )
  const [payType, setPayType] = useState<PayType | "">("")
  const [checkout, setCheckout] = useState<{
    id: number
    intent?: PurchaseIntent
    payType?: PayType
    orderNo?: string
  } | null>(orderNo ? { id: 0, orderNo } : null)
  const [sequence, setSequence] = useState(0)
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
    return <QueryError error={catalog.error} onRetry={() => void catalog.refetch()} />
  if (quotes.isError)
    return <QueryError error={quotes.error} onRetry={() => void quotes.refetch()} />
  const entitlement = quotes.data.entitlement
  const active = entitlement.status === "active"
  const selected =
    selection ??
    defaultSelection(catalog.data, quotes.data, {
      tier: params.get("tier"),
      option: params.get("option"),
    })
  const model = checkoutModel(catalog.data, quotes.data, selected)
  const channel =
    catalog.data.payTypes.find((type) => type === payType) ?? catalog.data.payTypes[0] ?? ""
  const choose = (intent: PurchaseIntent) => {
    const id = sequence + 1
    setSequence(id)
    setCheckout({ id, intent, payType: channel || undefined })
  }
  return (
    <main className="page-shell pb-36 sm:pb-8">
      <div>
        <h1 className="page-title">会员</h1>
        {!active && <p>开通会员后即可在桌面端使用 PigClaude</p>}
        <p className="mt-2 text-sm text-[var(--meta)]">查看你的会员状态、有效期和可用套餐。</p>
      </div>
      <section className="home-card" aria-labelledby="membership-status">
        <h2 id="membership-status">当前权益</h2>
        <p>{active ? `会员有效 · ${entitlement.tier?.name ?? ""}` : "会员已过期或未激活"}</p>
        {entitlement.validUntil && <p>有效期至 {formatTime(entitlement.validUntil)}</p>}
        <p>剩余 {formatDurationSeconds(entitlement.remainingSeconds)}</p>
        {active ? (
          <div className="status-gate" role="status">
            <strong>等待桌面客户端发起授权</strong>
            <p>请从 PigClaude 桌面客户端发起设备授权，再打开客户端提供的合法授权链接。</p>
          </div>
        ) : (
          <div className="status-gate" role="status">
            <strong>需要有效会员才能授权设备</strong>
            <p>请先选择下方套餐开通会员，再从桌面客户端发起授权。</p>
          </div>
        )}
      </section>
      <MembershipCards
        cards={model.cards}
        selected={model.selectedTier}
        onSelect={(tier) => setSelection(defaultSelection(catalog.data, quotes.data, { tier }))}
      />
      <DurationPicker
        options={model.options}
        selected={model.selectedOptionId}
        onSelect={(option) => setSelection({ ...selected, option })}
      />
      <BenefitGrid
        items={model.cards.find((card) => card.code === model.selectedTier)?.benefits ?? []}
      />
      <RemainingUpgradeBanner
        offer={model.remainingUpgrade}
        disabled={!catalog.data.payTypes.length}
        onChoose={() => {
          if (model.remainingUpgrade)
            choose({ remainingUpgrade: { tierCode: model.remainingUpgrade.tierCode } })
        }}
      />
      <CheckoutBar
        model={model}
        payTypes={catalog.data.payTypes}
        payType={channel}
        onPayType={setPayType}
        onChoose={() => {
          if (model.cta.intent) choose(model.cta.intent)
        }}
      />
      <PurchaseHistory ownerId={ownerId} session={session} />
      {checkout && (
        <PayDialog
          key={checkout.id}
          ownerId={ownerId}
          intent={checkout.intent}
          initialPayType={checkout.payType}
          payTypes={catalog.data.payTypes}
          orderNo={checkout.orderNo}
          onClose={() => setCheckout(null)}
        />
      )}
    </main>
  )
}
