// 负责冻结订单摘要表格与详情入口，金额只格式化服务端字符串。
import type { AdminOrder } from "@pigclaude/api/membership/types"
import { TierBadge } from "@pigclaude/web-ui/components/tier-badge"
import { formatFen, formatTime } from "@pigclaude/web-ui/lib/format"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { TableEmptyRow, TableLoadingRows } from "@/components/shell/table-states"
import { OrderWarningIcon } from "@/components/icon"
import { CopyButton } from "./copy-button"
import {
  hasShortfall,
  PAY_TYPE_LABEL,
  PURPOSE_LABEL,
  STATUS_LABEL,
  STATUS_TONE,
} from "./order-labels"
/** 列表支持行点击与 Enter，错误和加载状态保留重试入口。 */
export function OrderTable({
  items,
  pending,
  failed,
  retry,
  select,
}: {
  items: AdminOrder[]
  pending: boolean
  failed: boolean
  retry: () => void
  select: (order: AdminOrder) => void
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {["单号", "邮箱", "商品", "金额", "支付方式", "状态"].map((label) => (
            <TableHead key={label}>{label}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {pending ? (
          <TableLoadingRows columns={6} />
        ) : failed ? (
          <TableRow>
            <TableCell colSpan={6}>
              <p role="alert">
                订单加载失败
                <Button variant="outline" aria-label="重试订单" onClick={retry}>
                  重试
                </Button>
              </p>
            </TableCell>
          </TableRow>
        ) : items.length === 0 ? (
          <TableEmptyRow columns={6} title="暂无订单" />
        ) : (
          items.map((item) => <OrderRow key={item.orderNo} item={item} select={select} />)
        )}
      </TableBody>
    </Table>
  )
}
function OrderRow({ item, select }: { item: AdminOrder; select: (order: AdminOrder) => void }) {
  const shortfall = hasShortfall(item.creditShortfallFen)
  return (
    <TableRow
      tabIndex={0}
      className="cursor-pointer focus-visible:outline focus-visible:outline-ring"
      onClick={() => select(item)}
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.target === event.currentTarget) {
          event.preventDefault()
          select(item)
        }
      }}
    >
      <TableCell>
        <span className="font-mono">
          {item.orderNo.slice(0, 6)}…{item.orderNo.slice(-2)}
        </span>
        <CopyButton label="单号" value={item.orderNo} />
        <p className="text-xs text-muted-foreground">{formatTime(item.createdAt)}</p>
      </TableCell>
      <TableCell>{item.email}</TableCell>
      <TableCell>
        <TierBadge name={item.tierName} cardStyle={item.cardStyle} />
        <p>
          {item.months === null ? "剩余有效期升级" : `${item.months} 个月`} ·{" "}
          {PURPOSE_LABEL[item.purpose]}
        </p>
      </TableCell>
      <TableCell>
        <span className="font-medium tabular-nums">
          {formatFen(item.paidFen ?? item.payableFen)}
        </span>
        {shortfall ? (
          <p className="flex items-center gap-1 text-xs text-danger-ink">
            <OrderWarningIcon className="size-4" aria-label="少收警示" aria-hidden={undefined} />
            少收 {formatFen(item.creditShortfallFen)}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            {item.paidFen === null ? "未支付" : `抵扣 ${formatFen(item.creditFen)}`}
          </p>
        )}
      </TableCell>
      <TableCell>{PAY_TYPE_LABEL[item.payType]}</TableCell>
      <TableCell>
        <Badge variant={STATUS_TONE[item.status]}>{STATUS_LABEL[item.status]}</Badge>
      </TableCell>
    </TableRow>
  )
}
