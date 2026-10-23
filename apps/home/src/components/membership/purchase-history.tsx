// 展开后按身份和会话读取本人订单历史，服务端游标决定分页。
import { useState } from "react"
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query"
import { StaleSessionResponse } from "@pigclaude/api/client"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@pigclaude/web-ui/components/collapsible"
import { Input } from "@pigclaude/web-ui/components/input"
import { Button } from "@pigclaude/web-ui/components/button"
import { Skeleton } from "@pigclaude/web-ui/components/skeleton"
import { TierBadge } from "@pigclaude/web-ui/components/tier-badge"
import { formatFen, formatTime } from "@pigclaude/web-ui/lib/format"
import { homeApi } from "@/lib/api"
import { homeSessionGeneration } from "@/lib/session-generation"
/** 收起状态不请求，任何迟到结果均须重新通过当前身份校验。 */
export function PurchaseHistory({ ownerId, session }: { ownerId: string; session: number }) {
  const [copyResult, setCopyResult] = useState<{ orderNo: string; failed: boolean } | null>(null)
  async function copy(orderNo: string) {
    try {
      if (!navigator.clipboard) throw new Error("CLIPBOARD_UNAVAILABLE")
      await navigator.clipboard.writeText(orderNo)
      setCopyResult({ orderNo, failed: false })
    } catch {
      setCopyResult({ orderNo, failed: true })
    }
  }
  const [open, setOpen] = useState(false)
  const client = useQueryClient()
  const history = useInfiniteQuery({
    queryKey: ["membership-orders", ownerId, session],
    enabled: open,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const page = await homeApi.membership.orders({ cursor: pageParam, limit: 10 })
      if (
        signal.aborted ||
        homeSessionGeneration.current() !== session ||
        client.getQueryData<{ id: string }>(["me"])?.id !== ownerId
      )
        throw new StaleSessionResponse()
      return page
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  })
  const purposes = { open: "开通", renew: "续费", upgrade: "升级", upgrade_remaining: "剩余升级" }
  const statuses = {
    pending: "待支付",
    activated: "已生效",
    needs_review: "人工处理中",
    expired: "已过期",
    closed: "已关闭",
  }
  const orders = history.data?.pages.flatMap((page) => page.items) ?? []
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="purchase-history">
      <CollapsibleTrigger asChild>
        <button type="button" className="purchase-history-trigger">
          <span>购买记录</span>
          <span className="purchase-history-toggle" aria-hidden="true">
            {open ? "收起" : "展开 ›"}
          </span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {history.isPending ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : history.isError ? (
          <div className="purchase-history-empty" role="alert">
            购买记录读取失败
            <Button size="sm" variant="outline" onClick={() => void history.refetch()}>
              重试
            </Button>
          </div>
        ) : (
          <>
            {!orders.length && <p className="purchase-history-empty">暂无购买记录</p>}
            <ul>
              {orders.map((order) => (
                <li className="purchase-row" key={order.orderNo}>
                  <TierBadge {...order.tier} />
                  <span className="purchase-row-title">
                    {order.tier.name}
                    {order.months === null ? "" : ` ${order.months} 个月`} ·{" "}
                    {order.months === null ? "剩余升级" : purposes[order.purpose]}
                  </span>
                  <span className="purchase-row-amount">
                    {formatFen(order.paidFen ?? order.payableFen)}
                  </span>
                  <span className="purchase-status" data-status={order.status}>
                    {statuses[order.status]}
                  </span>
                  <time className="purchase-row-time" dateTime={order.createdAt}>
                    {formatTime(order.createdAt)}
                  </time>
                  {order.status === "needs_review" && (
                    <Button size="sm" variant="outline" onClick={() => void copy(order.orderNo)}>
                      复制单号
                    </Button>
                  )}
                  {copyResult?.orderNo === order.orderNo && (
                    <div className="purchase-row-copy">
                      <p role="status">
                        {copyResult.failed ? "复制失败，请手动复制单号" : "单号已复制"}
                      </p>
                      {copyResult.failed && (
                        <Input
                          aria-label="完整单号"
                          className="w-full select-text font-mono"
                          readOnly
                          value={order.orderNo}
                          onFocus={(event) => event.currentTarget.select()}
                        />
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {history.hasNextPage && (
              <div className="p-3 text-center">
                <Button
                  variant="ghost"
                  disabled={history.isFetchingNextPage}
                  onClick={() => void history.fetchNextPage()}
                >
                  加载更多
                </Button>
              </div>
            )}
          </>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}
