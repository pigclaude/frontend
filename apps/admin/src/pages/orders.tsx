// 负责只读订单、历史等级元数据及服务端全部筛选，不计算业务金额或解释游标。
import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useLocation } from "react-router"
import type { AdminOrder, AdminOrdersQuery, OrderStatus } from "@pigclaude/api/membership/types"
import { formatFen } from "@pigclaude/web-ui/lib/format"
import { adminApi } from "@/lib/api"
import { useAdminMe } from "@/hooks/use-admin-me"
import { PageHead } from "@/components/shell/page-head"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table"
import { adminSessionGeneration } from "@/lib/session-generation"
const statuses: Record<OrderStatus, string> = {
  pending: "待支付",
  activated: "已生效",
  needs_review: "待处理",
  expired: "已过期",
  closed: "已关闭",
}
/** payment:read 独立访问订单，不读取完整会员等级目录。 */
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
  const [filters, setFilters] = useState<AdminOrdersQuery>({})
  const [input, setInput] = useState("")
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined])
  const cursor = cursors.at(-1)
  const query = useQuery({
    queryKey: ["admin-orders", identity, filters, cursor],
    queryFn: () => adminApi.membership.orders.list({ ...filters, cursor, limit: 20 }),
    retry: false,
  })
  function filter(patch: AdminOrdersQuery) {
    setFilters({ ...filters, ...patch })
    setCursors([undefined])
  }
  return (
    <div className="flex flex-col gap-6">
      <PageHead title="订单" subtitle="冻结订单金额与支付状态；1 个月按 30 天计。" />
      <form
        className="flex flex-wrap items-center gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          filter({ q: input.trim() || undefined })
        }}
      >
        <Input
          aria-label="搜索订单"
          placeholder="单号、用户 ID 或邮箱"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={100}
        />
        <Button type="submit">搜索</Button>
        <label>
          状态
          <select
            aria-label="订单状态"
            className="rounded-md border p-2"
            value={filters.status ?? ""}
            onChange={(e) =>
              filter({ status: (e.target.value || undefined) as OrderStatus | undefined })
            }
          >
            <option value="">全部状态</option>
            {Object.entries(statuses).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          等级
          <select
            aria-label="订单等级"
            className="rounded-md border p-2"
            value={filters.tierId ?? ""}
            onChange={(e) => filter({ tierId: e.target.value || undefined })}
          >
            <option value="">全部等级</option>
            {query.data?.filterTiers.map((tier) => (
              <option key={tier.id} value={tier.id}>
                {tier.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          起始时间
          <Input
            type="datetime-local"
            aria-label="起始时间"
            onChange={(e) =>
              filter({ from: e.target.value ? new Date(e.target.value).toISOString() : undefined })
            }
          />
        </label>
        <label>
          截止时间
          <Input
            type="datetime-local"
            aria-label="截止时间"
            onChange={(e) =>
              filter({ to: e.target.value ? new Date(e.target.value).toISOString() : undefined })
            }
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={!!filters.needsReview}
            onChange={(e) => filter({ needsReview: e.target.checked || undefined })}
          />
          只看待处理
        </label>
        <label>
          <input
            type="checkbox"
            checked={!!filters.stale}
            onChange={(e) => filter({ stale: e.target.checked || undefined })}
          />
          只看少收
        </label>
      </form>
      {query.isPending && <p role="status">加载中…</p>}
      {query.isError && (
        <p role="alert">
          订单加载失败<Button onClick={() => void query.refetch()}>重试</Button>
        </p>
      )}
      {query.data && (
        <Table>
          <TableHeader>
            <TableRow>
              {[
                "单号",
                "用户",
                "等级 / 月数",
                "按月购买 / 抵扣 / 应付 / 实付",
                "支付方式",
                "平台流水",
                "状态",
                "时间",
              ].map((label) => (
                <TableHead key={label}>{label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.data.items.map((item) => (
              <OrderRow key={item.orderNo} item={item} />
            ))}
            {query.data.items.length === 0 && (
              <TableRow>
                <TableCell colSpan={8}>暂无订单</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}
      <div className="flex gap-3">
        <Button
          variant="outline"
          disabled={cursors.length === 1}
          onClick={() => setCursors(cursors.slice(0, -1))}
        >
          上一页
        </Button>
        <Button
          variant="outline"
          disabled={!query.data?.nextCursor || query.isFetching || query.isError}
          onClick={() => {
            if (query.data?.nextCursor) setCursors([...cursors, query.data.nextCursor])
          }}
        >
          下一页
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setCursors([undefined])
            void query.refetch()
          }}
        >
          刷新
        </Button>
      </div>
    </div>
  )
}
function OrderRow({ item }: { item: AdminOrder }) {
  const shortfall = !/^0+$/.test(item.creditShortfallFen)
  return (
    <TableRow
      className={item.status === "needs_review" || shortfall ? "text-destructive" : undefined}
    >
      <TableCell>{item.orderNo}</TableCell>
      <TableCell>
        {item.email}
        <p>{item.userId}</p>
      </TableCell>
      <TableCell>
        {item.tierName}
        <p>{item.months === null ? "剩余有效期升级" : `${item.months} 个月`}</p>
      </TableCell>
      <TableCell>
        {formatFen(item.listPriceFen)} / {formatFen(item.creditFen)} / {formatFen(item.payableFen)}{" "}
        / {item.paidFen === null ? "未支付" : formatFen(item.paidFen)}
      </TableCell>
      <TableCell>{{ alipay: "支付宝", wxpay: "微信支付", free: "免费" }[item.payType]}</TableCell>
      <TableCell>{item.gatewayTradeNo ?? "—"}</TableCell>
      <TableCell>
        {statuses[item.status]}
        {shortfall && <p>少收 {formatFen(item.creditShortfallFen)}</p>}
      </TableCell>
      <TableCell>
        创建：{item.createdAt}
        {item.activatedAt && <p>生效：{item.activatedAt}</p>}
      </TableCell>
    </TableRow>
  )
}
