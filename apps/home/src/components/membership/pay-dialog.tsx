// 负责真实支付弹窗、二维码及订单轮询，关闭和会话失效后拒绝迟到结果。
"use client"
import { useLayoutEffect, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { QRCodeSVG } from "qrcode.react"
import { ApiError } from "@pigclaude/api/client"
import type { CreatedOrder, OrderStatus, PayType } from "@pigclaude/api/membership/types"
import { Button } from "@pigclaude/web-ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@pigclaude/web-ui/components/dialog"
import { formatFen } from "@pigclaude/web-ui/lib/format"
import { homeApi } from "@/lib/api"
import { homeSessionGeneration } from "@/lib/session-generation"
import { PaymentMethods } from "./payment-methods"
import type { PurchaseIntent } from "./checkout-model"

/** 每次挂载代表一次独立支付意图；父页面以账户和路由隔离挂载。 */
export function PayDialog({
  ownerId,
  intent,
  payTypes,
  initialPayType,
  orderNo,
  onClose,
}: {
  ownerId: string
  intent?: PurchaseIntent
  payTypes: PayType[]
  initialPayType?: PayType
  orderNo?: string
  onClose: () => void
}) {
  const client = useQueryClient()
  const [payType, setPayType] = useState<PayType | "">(
    initialPayType && payTypes.includes(initialPayType) ? initialPayType : (payTypes[0] ?? ""),
  )
  const [order, setOrder] = useState<CreatedOrder | null>(null)
  const [amount, setAmount] = useState<string | null>(null)
  const [status, setStatus] = useState<OrderStatus | "select">(orderNo ? "pending" : "select")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [opened, setOpened] = useState(false)
  const [visible, setVisible] = useState(true)
  const token = useRef<symbol | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const session = useRef(homeSessionGeneration.current())
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const current = (id: symbol) =>
    token.current === id &&
    session.current === homeSessionGeneration.current() &&
    client.getQueryData<{ id: string }>(["me"])?.id === ownerId
  function stop() {
    token.current = null
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }
  function close() {
    stop()
    setVisible(false)
    closeRef.current()
  }
  function success(id: symbol) {
    if (!current(id)) return
    setStatus("activated")
    void client.invalidateQueries({ queryKey: ["membership-orders", ownerId] })
    void client.invalidateQueries({ queryKey: ["entitlement"] })
    void client.invalidateQueries({ queryKey: ["membership-quotes", ownerId] })
    timer.current = setTimeout(() => {
      if (current(id)) close()
      else stop()
    }, 3000)
  }
  function poll(number: string, id: symbol) {
    if (!current(id)) {
      stop()
      return
    }
    void homeApi.membership
      .order(number)
      .then((result) => {
        if (!current(id)) return
        setAmount(result.payableFen)
        setStatus(result.status)
        setError(null)
        if (result.status === "activated") success(id)
        else if (result.status === "pending") schedule(number, id)
        else {
          timer.current = null
          token.current = null
        }
      })
      .catch(() => {
        if (!current(id)) return
        setError("订单状态读取失败，正在重试")
        schedule(number, id)
      })
  }
  function schedule(number: string, id: symbol) {
    timer.current = setTimeout(() => poll(number, id), 2000)
  }
  const pollRef = useRef(poll)
  pollRef.current = poll
  useLayoutEffect(() => {
    const id = Symbol()
    token.current = id
    if (orderNo) pollRef.current(orderNo, id)
    return stop
  }, [orderNo])
  async function create() {
    if (!intent || !payType || busy || !payTypes.includes(payType)) return
    stop()
    const id = Symbol()
    token.current = id
    if (!current(id)) return
    setBusy(true)
    setError(null)
    try {
      const result = await homeApi.membership.createOrder({ ...intent, payType }, () => current(id))
      if (!current(id)) return
      setOrder(result)
      setAmount(result.payableFen)
      if (result.payment.kind === "free") success(id)
      else {
        setStatus("pending")
        if (result.payment.kind === "redirect") {
          const popup = window.open(result.payment.url, "_blank")
          if (popup) popup.opener = null
          setOpened(popup !== null)
        }
        schedule(result.orderNo, id)
      }
    } catch (cause) {
      if (!current(id)) return
      setError(
        cause instanceof ApiError && cause.code === "PAYMENT_CHANNEL_UNAVAILABLE"
          ? "此支付渠道暂不可用，请换一种支付方式"
          : cause instanceof ApiError && cause.code === "PAYMENT_UNAVAILABLE"
            ? "在线支付暂未开放"
            : "创建订单失败，请重试",
      )
    } finally {
      if (current(id)) setBusy(false)
    }
  }
  const payment = order?.payment
  return (
    <Dialog
      open={visible}
      onOpenChange={(next) => {
        if (!next) close()
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogTitle>会员支付</DialogTitle>
        <DialogDescription>支付状态以服务器确认结果为准。</DialogDescription>
        {amount !== null && <p>应付 {formatFen(amount)}</p>}
        {status === "select" && (
          <>
            {payTypes.length === 0 ? (
              <p>在线支付暂未开放</p>
            ) : (
              <>
                <PaymentMethods
                  payTypes={payTypes}
                  value={payType}
                  onChange={setPayType}
                  disabled={busy}
                />
                <Button disabled={busy || !intent || !payType} onClick={() => void create()}>
                  {busy ? "正在创建订单…" : "创建订单"}
                </Button>
              </>
            )}
          </>
        )}
        {status === "pending" && (
          <>
            {payment?.kind === "qr" && (
              <>
                {payment.qrcode ? (
                  <QRCodeSVG value={payment.qrcode} aria-label="付款二维码" size={220} />
                ) : payment.imageUrl ? (
                  <img src={payment.imageUrl} alt="付款二维码" width={220} height={220} />
                ) : (
                  <p>付款码暂不可用，请稍后重新查询订单</p>
                )}
                <p>请用{payType === "wxpay" ? "微信" : "支付宝"}扫码</p>
              </>
            )}
            {payment?.kind === "redirect" && (
              <>
                <p>
                  {opened ? "已在新窗口打开收银台" : "浏览器阻止了新窗口，请点击下方链接打开收银台"}
                </p>
                <a href={payment.url} target="_blank" rel="noopener noreferrer">
                  打开收银台
                </a>
              </>
            )}
            <p role="status">正在等待支付结果…</p>
          </>
        )}
        {status === "activated" && <p role="status">支付成功，会员已生效</p>}
        {(status === "expired" || status === "closed") && (
          <>
            <p>订单已过期，请重新下单</p>
            <Button
              onClick={() => {
                stop()
                if (intent) {
                  setOrder(null)
                  setAmount(null)
                  setStatus("select")
                } else close()
              }}
            >
              {intent ? "重新下单" : "返回选择套餐"}
            </Button>
          </>
        )}
        {status === "needs_review" && <p>付款已收到，正在人工处理，请联系客服</p>}
        {error && <p role="alert">{error}</p>}
        <Button variant="outline" onClick={close}>
          关闭
        </Button>
      </DialogContent>
    </Dialog>
  )
}
