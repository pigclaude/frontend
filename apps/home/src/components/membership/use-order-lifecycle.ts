// 管理本人订单代次、会话守卫、串行轮询和成功刷新，拒绝所有过期异步交付。
"use client"
import { useCallback, useEffect, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { ApiError, StaleSessionResponse } from "@pigclaude/api/client"
import type {
  CreatedOrder,
  HomeOrder,
  OrderPresentation,
  PayType,
} from "@pigclaude/api/membership/types"
import { homeApi } from "@/lib/api"
import { homeSessionGeneration } from "@/lib/session-generation"
import type { PurchaseIntent } from "./checkout-model"
/** 生命周期终态不会自行推断付款成功。 */
export type LifecycleStatus =
  | "idle"
  | "creating"
  | "pending"
  | "activated"
  | "expired"
  | "closed"
  | "needs_review"
  | "confirm-free"
/** 仅持有当前归属响应的展示数据；回跳不伪造支付载体。 */
export function useOrderLifecycle({ ownerId, orderNo }: { ownerId: string; orderNo?: string }) {
  const client = useQueryClient()
  const [status, setStatus] = useState<LifecycleStatus>(orderNo ? "pending" : "idle")
  const [order, setOrder] = useState<CreatedOrder | null>(null)
  const [metadata, setMetadata] = useState<HomeOrder | null>(null)
  const [amountFen, setAmount] = useState<string | null>(null)
  const [presentation, setPresentation] = useState<OrderPresentation | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [opened, setOpened] = useState(false)
  const token = useRef<symbol | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const session = useRef(homeSessionGeneration.current())
  const number = useRef<string | null>(orderNo ?? null)
  const lookup = useRef(0)
  const current = useCallback(
    (id: symbol) =>
      token.current === id &&
      session.current === homeSessionGeneration.current() &&
      client.getQueryData<{ id: string }>(["me"])?.id === ownerId,
    [client, ownerId],
  )
  const clearTimer = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }, [])
  const stop = useCallback(() => {
    token.current = null
    lookup.current++
    clearTimer()
  }, [clearTimer])
  const isCurrent = useCallback(() => token.current !== null && current(token.current), [current])
  async function success(id: symbol, request = lookup.current) {
    if (!current(id)) return
    clearTimer()
    // 会员页可能接手账户页留下的无观察者请求，先取消旧快照再读取付款后的权益。
    await client.cancelQueries({ queryKey: ["entitlement"] })
    if (!current(id) || request !== lookup.current) return
    await Promise.all([
      client.invalidateQueries({ queryKey: ["entitlement"] }),
      client.invalidateQueries({ queryKey: ["membership-quotes", ownerId] }),
      client.invalidateQueries({ queryKey: ["membership-orders", ownerId] }),
    ])
    if (!current(id) || request !== lookup.current) return
    await client.fetchQuery({
      queryKey: ["entitlement"],
      retry: false,
      queryFn: async ({ signal }) => {
        const result = await homeApi.membership.entitlement()
        if (signal.aborted || !current(id) || request !== lookup.current)
          throw new StaleSessionResponse()
        return result
      },
    })
    if (current(id) && request === lookup.current) setStatus("activated")
  }
  async function poll(no: string, id: symbol) {
    if (!current(id)) {
      stop()
      return
    }
    clearTimer()
    const request = ++lookup.current
    try {
      const result = await homeApi.membership.order(no)
      if (!current(id) || request !== lookup.current) return
      setMetadata(result)
      setAmount(result.payableFen)
      setPresentation(result.presentation)
      setError(null)
      if (result.status === "activated") await success(id, request)
      else {
        setStatus(result.status)
        if (result.status === "pending") schedule(no, id)
        else stop()
      }
    } catch {
      if (!current(id) || request !== lookup.current) return
      setError("订单状态读取失败，正在重试")
      schedule(no, id)
    }
  }
  function schedule(no: string, id: symbol) {
    clearTimer()
    timer.current = setTimeout(() => void pollRef.current(no, id), 2000)
  }
  const pollRef = useRef(poll)
  pollRef.current = poll
  useEffect(() => {
    if (orderNo) {
      const id = Symbol()
      token.current = id
      // 延迟至当前 effect 安装完成；StrictMode 清理会取消首轮，避免重复传输。
      timer.current = setTimeout(() => void pollRef.current(orderNo, id), 0)
    }
    return stop
  }, [orderNo, stop])
  async function create(intent: PurchaseIntent, payType: PayType) {
    stop()
    const id = Symbol()
    token.current = id
    if (!current(id)) return
    number.current = null
    setOrder(null)
    setMetadata(null)
    setPresentation(null)
    setAmount(null)
    setError(null)
    setStatus("creating")
    try {
      const result = await homeApi.membership.createOrder({ ...intent, payType }, () => current(id))
      if (!current(id)) return
      number.current = result.orderNo
      setOrder(result)
      setAmount(result.payableFen)
      setPresentation(result.presentation)
      if (result.payment.kind === "free") await success(id)
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
      setStatus("idle")
      setError(
        cause instanceof ApiError && cause.code === "PAYMENT_CHANNEL_UNAVAILABLE"
          ? "此支付渠道暂不可用，请换一种支付方式"
          : cause instanceof ApiError && cause.code === "PAYMENT_UNAVAILABLE"
            ? "在线支付暂未开放"
            : "创建订单失败，请重试",
      )
    }
  }
  function checkNow() {
    const id = token.current
    if (id && number.current) void pollRef.current(number.current, id)
  }
  return {
    status,
    order,
    metadata,
    amountFen,
    presentation,
    error,
    opened,
    create,
    checkNow,
    stop,
    isCurrent,
  }
}
