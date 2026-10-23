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
import { formatDurationSeconds, formatTime } from "@pigclaude/web-ui/lib/format"
import type { PurchaseIntent } from "./checkout-model"
import { PaymentMethods } from "./payment-methods"
import { useOrderLifecycle } from "./use-order-lifecycle"
import {
  CashierView,
  ExpiredView,
  FreeView,
  PayDetails,
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
  const mobile = useMediaQuery("(max-width: 639px)")
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
    if (activated) latest.current.props.onActivated()
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
              ? `${actual.tier.name} · 剩余 ${formatDurationSeconds(actual.durationSeconds)}`
              : `${actual.tier.name} · ${actual.months} 个月`,
          optionPriceFen: actual.optionPriceFen,
          creditFen: actual.creditFen,
          payableFen: lifecycle.amountFen,
          bonusSeconds: actual.bonusSeconds,
        }
      : props.summary
  const status = confirmFree ? "confirm-free" : lifecycle.status
  const payment = lifecycle.order?.payment
  const entitlement =
    status === "activated" ? client.getQueryData<EntitlementResponse>(["entitlement"]) : undefined
  const content = (
    <>
      {summary && <PayDetails summary={summary} />}
      {!summary && lifecycle.amountFen !== null && <p>{lifecycle.amountFen}</p>}
      {status === "confirm-free" && <FreeView confirm={() => create()} />}
      {status === "creating" && (
        <div
          role="status"
          aria-label="正在创建订单"
          className="h-24 animate-pulse motion-reduce:animate-none"
        />
      )}
      {(status === "pending" || status === "idle") && props.intent && (
        <PaymentMethods
          payTypes={props.payTypes}
          value={payType}
          onChange={(channel) => {
            setPayType(channel)
            create(channel)
          }}
        />
      )}
      {!props.payTypes.length && props.intent && <p>在线支付暂未开放</p>}
      {status === "pending" && (
        <>
          {payment?.kind === "qr" && lifecycle.order && (
            <QrView
              payment={payment}
              payType={payType}
              mobile={mobile}
              expiresAt={lifecycle.order.expiresAt}
            />
          )}
          {payment?.kind === "redirect" && (
            <CashierView url={payment.url} opened={lifecycle.opened} />
          )}
          <p role="status">正在等待支付结果…</p>
          <Button onClick={lifecycle.checkNow}>我已完成支付</Button>
        </>
      )}
      {status === "activated" && (
        <SuccessView
          tierName={summary?.tierName ?? "会员"}
          validUntil={entitlement?.validUntil ? formatTime(entitlement.validUntil) : undefined}
          finish={() => close(true)}
        />
      )}
      {(status === "expired" || status === "closed") && (
        <ExpiredView
          canRecreate={!!props.intent}
          retry={() => (props.intent ? create() : close())}
        />
      )}
      {status === "needs_review" && (
        <PendingReviewView
          orderNo={lifecycle.metadata?.orderNo ?? lifecycle.order?.orderNo ?? props.orderNo ?? ""}
        />
      )}
      {lifecycle.error && <p role="alert">{lifecycle.error}</p>}
      {status === "idle" && lifecycle.error && props.intent && (
        <Button onClick={() => create()}>重试</Button>
      )}
      <Button variant="outline" onClick={() => close()}>
        关闭
      </Button>
    </>
  )
  return mobile ? (
    <Sheet
      open={visible}
      onOpenChange={(next) => {
        if (!next) close()
      }}
    >
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="max-h-[90dvh] overflow-y-auto p-6 motion-reduce:animate-none"
      >
        <SheetTitle>会员支付</SheetTitle>
        <SheetDescription>支付状态以服务器确认结果为准。</SheetDescription>
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
        className="max-h-[90dvh] overflow-y-auto motion-reduce:animate-none"
      >
        <DialogTitle>会员支付</DialogTitle>
        <DialogDescription>支付状态以服务器确认结果为准。</DialogDescription>
        {content}
      </DialogContent>
    </Dialog>
  )
}
