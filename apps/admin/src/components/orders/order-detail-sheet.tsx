// 负责只读订单详情、冻结金额拆解和服务端时间线。
import type { AdminOrder } from "@pigclaude/api/membership/types"
import { TierBadge } from "@pigclaude/web-ui/components/tier-badge"
import { formatFen, formatTime } from "@pigclaude/web-ui/lib/format"
import { Badge } from "@/components/ui/badge"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { CopyButton } from "./copy-button"
import {
  hasShortfall,
  PAY_TYPE_LABEL,
  PURPOSE_LABEL,
  STATUS_LABEL,
  STATUS_TONE,
} from "./order-labels"
/** 详情只接收当前 owner 的订单快照，关闭立即释放选中记录。 */
export function OrderDetailSheet({
  order,
  close,
}: {
  order: AdminOrder | null
  close: () => void
}) {
  return (
    <Sheet
      open={order !== null}
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      {order && (
        <SheetContent className="overflow-y-auto motion-reduce:animate-none">
          <SheetHeader>
            <SheetTitle>
              订单详情{" "}
              <Badge variant={STATUS_TONE[order.status]}>{STATUS_LABEL[order.status]}</Badge>
            </SheetTitle>
            <SheetDescription>冻结订单金额与支付记录；1 个月按 30 天计。</SheetDescription>
          </SheetHeader>
          <div className="space-y-6 p-5">
            <section className="space-y-2">
              <h3 className="font-medium">支付信息</h3>
              <p className="break-all">
                单号：<span>{order.orderNo}</span>
                <CopyButton label="单号" value={order.orderNo} />
              </p>
              <p className="break-all">
                平台流水：<span>{order.gatewayTradeNo ?? "—"}</span>
                {order.gatewayTradeNo && (
                  <CopyButton label="平台流水" value={order.gatewayTradeNo} />
                )}
              </p>
              <p>{PAY_TYPE_LABEL[order.payType]}</p>
            </section>
            <section>
              <h3 className="font-medium">用户</h3>
              <p>{order.email}</p>
              <p>{order.userId}</p>
            </section>
            <section>
              <h3 className="font-medium">商品</h3>
              <TierBadge name={order.tierName} cardStyle={order.cardStyle} />
              <p>{order.months === null ? "剩余有效期升级" : `${order.months} 个月`}</p>
              <p>{PURPOSE_LABEL[order.purpose]}</p>
            </section>
            <section>
              <h3 className="font-medium">金额拆解</h3>
              <dl className="space-y-2">
                {[
                  ["按月购买", formatFen(order.listPriceFen)],
                  ["档位价", formatFen(order.optionPriceFen)],
                  ["剩余价值抵扣", `−${formatFen(order.creditFen)}`],
                  ["应付", formatFen(order.payableFen)],
                  ["实付", order.paidFen === null ? "未支付" : formatFen(order.paidFen)],
                  ...(hasShortfall(order.creditShortfallFen)
                    ? [["少收", formatFen(order.creditShortfallFen)]]
                    : []),
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-4">
                    <dt>{label}</dt>
                    <dd className="tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
            <section>
              <h3 className="font-medium">时间线</h3>
              <ol className="mt-3 space-y-3 border-l pl-4">
                <li>
                  创建订单<p>{formatTime(order.createdAt)}</p>
                </li>
                {order.paidAt && (
                  <li>
                    支付到账<p>{formatTime(order.paidAt)}</p>
                  </li>
                )}
                {order.activatedAt && (
                  <li>
                    会员生效<p>{formatTime(order.activatedAt)}</p>
                  </li>
                )}
                {order.status === "expired" && <li>已过期 {formatTime(order.expiresAt)}</li>}
              </ol>
            </section>
          </div>
        </SheetContent>
      )}
    </Sheet>
  )
}
