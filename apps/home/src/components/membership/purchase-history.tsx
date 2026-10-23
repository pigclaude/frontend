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
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost">购买记录</Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {history.isPending ? (
          <Skeleton className="h-24" />
        ) : history.isError ? (
          <div role="alert">
            购买记录读取失败<Button onClick={() => void history.refetch()}>重试</Button>
          </div>
        ) : (
          <>
            {!orders.length && <p>暂无购买记录</p>}
            <ul>
              {orders.map((order) => (
                <li className="flex flex-wrap items-center gap-3 border-b py-4" key={order.orderNo}>
                  <TierBadge {...order.tier} />
                  <span>
                    {order.tier.name}
                    {order.months === null ? "" : ` ${order.months} 个月`} ·{" "}
                    {order.months === null ? "剩余升级" : purposes[order.purpose]}
                  </span>
                  <span>{formatFen(order.paidFen ?? order.payableFen)}</span>
                  <span>{statuses[order.status]}</span>
                  {order.status === "needs_review" && (
                    <Button variant="outline" onClick={() => void copy(order.orderNo)}>
                      复制单号
                    </Button>
                  )}
                  {copyResult?.orderNo === order.orderNo && (
                    <div>
                      <p role="status">
                        {copyResult.failed ? "复制失败，请手动复制单号" : "单号已复制"}
                      </p>
                      {copyResult.failed && (
                        <Input
                          aria-label="完整单号"
                          className="w-full select-text rounded border p-2 font-mono"
                          readOnly
                          value={order.orderNo}
                          onFocus={(event) => event.currentTarget.select()}
                        />
                      )}
                    </div>
                  )}
                  <time dateTime={order.createdAt}>{formatTime(order.createdAt)}</time>
                </li>
              ))}
            </ul>
            {history.hasNextPage && (
              <Button
                disabled={history.isFetchingNextPage}
                onClick={() => void history.fetchNextPage()}
              >
                加载更多
              </Button>
            )}
          </>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}
