// 将同一次本人支付意图投影为响应式面板，关闭与成功回调均检查生命周期归属。
"use client"
import { useEffect, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import type { CardStyle, EntitlementResponse, PayType } from "@pigclaude/api/membership/types"
import { Button } from "@pigclaude/web-ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@pigclaude/web-ui/components/dialog"
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from "@pigclaude/web-ui/components/sheet"
import { useMediaQuery } from "@pigclaude/web-ui/hooks/use-media-query"
import { remainingLabel } from "./membership-cards"
import type { PurchaseIntent } from "./checkout-model"
import { PaymentMethods } from "./payment-methods"
import { useOrderLifecycle } from "./use-order-lifecycle"
import { Skeleton } from "@pigclaude/web-ui/components/skeleton"
import { CloseIcon } from "@/components/icon"
import {
  CashierView,
  ExpiredView,
  FreeView,
  PayDetails,
  PayHeader,
  PendingReviewView,
  QrView,
  SuccessView,
} from "./pay-panel-views"
/** 初始报价只在尚未收到本人订单时展示。 */
export interface PaySummary {
  tierName: string
  cardStyle: CardStyle
  title: string
  optionPriceFen: string | null
  creditFen: string
  payableFen: string
  bonusSeconds: string
}
/** 一次挂载仅自动建单一次，显式换渠道与重试另开生命周期。 */
export function PayPanel(props: {
  ownerId: string
  intent?: PurchaseIntent
  payType: PayType
  payTypes: PayType[]
  summary?: PaySummary
  orderNo?: string
  onClose(): void
  onActivated(): void
}) {
  const client = useQueryClient()
  const lifecycle = useOrderLifecycle({ ownerId: props.ownerId, orderNo: props.orderNo })
  const [visible, setVisible] = useState(true)
  const [payType, setPayType] = useState(
    props.payTypes.includes(props.payType) ? props.payType : (props.payTypes[0] ?? props.payType),
  )
  const [confirmFree, setConfirmFree] = useState(
    !props.orderNo && props.summary?.payableFen === "0",
  )
  // 打开时定下用底部抽屉还是居中弹窗；旋转屏幕跨过断点也不换容器，避免面板内状态和焦点丢失。
  const narrow = useMediaQuery("(max-width: 639px)")
  const [mediaReady, setMediaReady] = useState(false)
  const [mobile, setMobile] = useState<boolean | null>(null)
  useEffect(() => {
    setMediaReady(true)
  }, [])
  useEffect(() => {
    if (mediaReady) setMobile((current) => current ?? narrow)
  }, [mediaReady, narrow])
  const latest = useRef({ props, lifecycle, payType })
  latest.current = { props, lifecycle, payType }
  const closed = useRef(false)
  function close(activated = false) {
    if (closed.current) return
    if (activated && !lifecycle.isCurrent()) {
      lifecycle.stop()
      return
    }
    closed.current = true
    lifecycle.stop()
    setVisible(false)
    latest.current.props.onClose()
    if (
      activated &&
      !latest.current.props.orderNo &&
      client.getQueryData<EntitlementResponse>(["entitlement"])?.status === "active"
    )
      latest.current.props.onActivated()
  }
  const finish = useRef(close)
  finish.current = close
  function create(channel = payType) {
    if (closed.current || !props.intent || !props.payTypes.includes(channel)) return
    setConfirmFree(false)
    void lifecycle.create(props.intent, channel)
  }
  const createRef = useRef(create)
  createRef.current = create
  useEffect(() => {
    if (props.orderNo || confirmFree) return
    const timer = setTimeout(() => createRef.current(), 0)
    return () => clearTimeout(timer)
    // 单次意图由父组件 key 标识；报价刷新和回调重渲染不能重新建单。
  }, [])
  useEffect(() => {
    if (lifecycle.status !== "activated") return
    const timer = setTimeout(() => finish.current(true), 2500)
    return () => clearTimeout(timer)
  }, [lifecycle.status])
  const actual = lifecycle.presentation
  const summary: PaySummary | undefined =
    actual && lifecycle.amountFen !== null
      ? {
          tierName: actual.tier.name,
          cardStyle: actual.tier.cardStyle,
          title:
            actual.months === null
              ? `${actual.tier.name} · 剩余 ${remainingLabel(actual.durationSeconds)}升级`
              : `${actual.tier.name} · ${actual.months} 个月`,
          optionPriceFen: actual.optionPriceFen,
          creditFen: actual.creditFen,
          payableFen: lifecycle.amountFen,
          bonusSeconds: actual.bonusSeconds,
        }
      : props.summary
  const idleBeforeCreate =
    lifecycle.status === "idle" &&
    !lifecycle.error &&
    !!props.intent &&
    props.payTypes.length > 0 &&
    !closed.current
  const status = confirmFree ? "confirm-free" : idleBeforeCreate ? "creating" : lifecycle.status
  const payment = lifecycle.order?.payment
  // 免费升级可能已在服务端生效，此时换渠道会按新身份报出付费订单，所以免费单不显示渠道。
  const free = summary?.payableFen === "0" || payment?.kind === "free"
  const showMethods =
    !free &&
    !!props.intent &&
    props.payTypes.length > 0 &&
    (status === "creating" || status === "pending" || (status === "idle" && !!lifecycle.error))
  const remaining = actual
    ? actual.months === null
    : !!props.intent && "remainingUpgrade" in props.intent
  const entitlement =
    status === "activated" ? client.getQueryData<EntitlementResponse>(["entitlement"]) : undefined
  const orderNumber = lifecycle.metadata?.orderNo ?? lifecycle.order?.orderNo ?? props.orderNo ?? ""
  const isMobile = mobile ?? (mediaReady ? narrow : false)
  const content = (
    <>
      <div className="pay-top">
        {summary ? <PayHeader summary={summary} /> : <span />}
        <button type="button" className="pay-close" aria-label="关闭" onClick={() => close()}>
          <CloseIcon />
        </button>
      </div>
      {status === "activated" ? (
        <SuccessView
          historical={!!props.orderNo}
          entitlement={entitlement}
          tierName={summary?.tierName ?? "会员"}
          finish={() => close(true)}
        />
      ) : (
        summary && <PayDetails summary={summary} remaining={remaining} />
      )}
      {status === "confirm-free" && <FreeView confirm={() => create()} />}
      {showMethods && (
        <PaymentMethods
          payTypes={props.payTypes}
          value={payType}
          disabled={status === "creating"}
          onChange={(channel) => {
            setPayType(channel)
            create(channel)
          }}
        />
      )}
      {status === "creating" && (
        <div className="pay-state" role="status" aria-label="正在创建订单">
          {!free && <Skeleton className="size-[196px] rounded-xl" />}
          <p className="pay-note">{free ? "正在为你升级" : "正在生成付款码"}</p>
        </div>
      )}
      {!props.payTypes.length && props.intent && <p className="pay-note">在线支付暂未开放</p>}
      {status === "pending" && (
        <>
          {payment?.kind === "qr" && lifecycle.order && (
            <QrView
              payment={payment}
              payType={payType}
              mobile={isMobile}
              expiresAt={lifecycle.order.expiresAt}
            />
          )}
          {payment?.kind === "redirect" && (
            <CashierView url={payment.url} opened={lifecycle.opened} />
          )}
          <p className="sr-only" role="status">
            正在等待支付结果…
          </p>
          <Button variant="outline" className="w-full" onClick={lifecycle.checkNow}>
            我已完成支付
          </Button>
        </>
      )}
      {(status === "expired" || status === "closed") && (
        <ExpiredView
          canRecreate={!!props.intent}
          retry={() => (props.intent ? create() : close())}
        />
      )}
      {status === "needs_review" && <PendingReviewView orderNo={orderNumber} />}
      {lifecycle.error && (
        <p className="pay-error" role="alert">
          {lifecycle.error}
        </p>
      )}
      {status === "idle" && lifecycle.error && props.intent && (
        <Button className="w-full" onClick={() => create()}>
          重试
        </Button>
      )}
    </>
  )
  return isMobile ? (
    <Sheet
      open={visible}
      onOpenChange={(next) => {
        if (!next) close()
      }}
    >
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="pay-panel max-h-[92dvh] overflow-y-auto rounded-t-2xl motion-reduce:animate-none"
      >
        <SheetTitle className="sr-only">会员支付</SheetTitle>
        <SheetDescription className="sr-only">支付状态以服务器确认结果为准。</SheetDescription>
        <span className="pay-grab" aria-hidden="true" />
        {content}
      </SheetContent>
    </Sheet>
  ) : (
    <Dialog
      open={visible}
      onOpenChange={(next) => {
        if (!next) close()
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="pay-panel max-h-[90dvh] overflow-y-auto sm:max-w-[400px] motion-reduce:animate-none"
      >
        <DialogTitle className="sr-only">会员支付</DialogTitle>
        <DialogDescription className="sr-only">支付状态以服务器确认结果为准。</DialogDescription>
        {content}
      </DialogContent>
    </Dialog>
  )
}
