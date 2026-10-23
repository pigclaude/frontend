// 负责订单页的 owner 边界、服务端查询和只读组件组装。
import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useLocation } from "react-router"
import type { AdminOrder, AdminOrdersQuery } from "@pigclaude/api/membership/types"
import { adminApi } from "@/lib/api"
import { useAdminMe } from "@/hooks/use-admin-me"
import { PageHead } from "@/components/shell/page-head"
import { TableCard } from "@/components/shell/table-card"
import { PagerFooter } from "@/components/shell/pager"
import { Button } from "@/components/ui/button"
import { adminSessionGeneration } from "@/lib/session-generation"
import { OrderSummaryCards } from "@/components/orders/order-summary-cards"
import { OrderToolbar } from "@/components/orders/order-toolbar"
import { OrderTable } from "@/components/orders/order-table"
import { OrderDetailSheet } from "@/components/orders/order-detail-sheet"
import { tabQuery, type OrderTab } from "@/components/orders/order-labels"
/** payment:read 独立访问订单，身份、路由或会话改变后重挂局部状态。 */
export default function OrdersPage() {
  const { data: me } = useAdminMe()
  const canRead = me?.status === "active" && me.permissions.includes("payment:read")
  const location = useLocation()
  if (!canRead) return <p role="alert">无权查看订单</p>
  return (
    <OrdersContent
      key={JSON.stringify([me.id, location.key, adminSessionGeneration.current()])}
      identity={me.id}
    />
  )
}
function OrdersContent({ identity }: { identity: string }) {
  const client = useQueryClient()
  const [filters, setFilters] = useState<AdminOrdersQuery>({})
  const [tab, setTab] = useState<OrderTab>("all")
  const [selected, setSelected] = useState<AdminOrder | null>(null)
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined])
  const cursor = cursors.at(-1)
  const query = useQuery({
    queryKey: ["admin-orders", identity, filters, cursor],
    queryFn: () => adminApi.membership.orders.list({ ...filters, cursor, limit: 20 }),
    retry: false,
  })
  const summary = useQuery({
    queryKey: ["admin-orders-summary", identity],
    queryFn: () => adminApi.membership.orders.summary(),
    retry: false,
  })
  function filter(patch: AdminOrdersQuery) {
    setFilters((current) => ({ ...current, ...patch }))
    setCursors([undefined])
  }
  function selectTab(next: OrderTab) {
    setTab(next)
    filter({ status: undefined, needsReview: undefined, ...tabQuery(next) })
  }
  function refresh() {
    setCursors([undefined])
    void client.invalidateQueries({ queryKey: ["admin-orders", identity] })
    void client.invalidateQueries({ queryKey: ["admin-orders-summary", identity] })
  }
  return (
    <div className="flex flex-col gap-6">
      <PageHead title="订单" subtitle="冻结订单金额与支付状态；1 个月按 30 天计。" />
      <OrderSummaryCards
        data={summary.data}
        failed={summary.isError}
        pending={summary.isPending}
        retry={() => void summary.refetch()}
        attention={() => selectTab("attention")}
      />
      <TableCard
        toolbar={
          <OrderToolbar
            tab={tab}
            onTab={selectTab}
            count={summary.isError ? undefined : summary.data?.needsReviewCount}
            filters={filters}
            tiers={query.data?.filterTiers ?? []}
            filter={filter}
          />
        }
        footer={
          <>
            <PagerFooter
              noun="条订单"
              pager={{
                items: query.data?.items ?? [],
                page: cursors.length,
                hasPrev: cursors.length > 1,
                hasNext: !!query.data?.nextCursor && !query.isFetching && !query.isError,
                prev: () => setCursors(cursors.slice(0, -1)),
                next: () => {
                  if (query.data?.nextCursor) setCursors([...cursors, query.data.nextCursor])
                },
              }}
            />
            <Button variant="outline" size="sm" onClick={refresh}>
              刷新
            </Button>
          </>
        }
      >
        <OrderTable
          items={query.data?.items ?? []}
          pending={query.isPending}
          failed={query.isError}
          retry={() => void query.refetch()}
          select={setSelected}
        />
      </TableCard>
      <OrderDetailSheet order={selected} close={() => setSelected(null)} />
    </div>
  )
}
