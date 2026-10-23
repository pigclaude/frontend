// 负责独立订单统计卡，统计错误不阻断列表。
import type { AdminOrdersSummary } from "@pigclaude/api/membership/types"
import { formatFen } from "@pigclaude/web-ui/lib/format"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { OrderRefreshIcon } from "@/components/icon"
/** 展示服务端统计并将待处理入口绑定到同一标签。 */
export function OrderSummaryCards({
  data,
  failed,
  pending,
  retry,
  attention,
}: {
  data?: AdminOrdersSummary
  failed: boolean
  pending: boolean
  retry: () => void
  attention: () => void
}) {
  const values =
    !data || failed
      ? ["—", "—", "—", "—"]
      : [
          formatFen(data.todayPaidFen),
          formatFen(data.monthPaidFen),
          String(data.monthActivatedCount),
          String(data.needsReviewCount),
        ]
  return (
    <section aria-label="订单统计" className="space-y-2">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {["今日实收", "本月实收", "本月生效", "待处理"].map((label, index) => {
          const content = (
            <>
              <span className="text-sm text-muted-foreground">{label}</span>
              {pending ? (
                <Skeleton className="mt-2 h-7 w-24" />
              ) : (
                <strong className="mt-2 block text-2xl tabular-nums">{values[index]}</strong>
              )}
            </>
          )
          const style = `rounded-xl border bg-card p-5 text-left ${index === 3 && !failed && (data?.needsReviewCount ?? 0) > 0 ? "border-danger" : "border-border"}`
          return index === 3 ? (
            <button
              key={label}
              className={style}
              aria-label={`待处理订单 ${values[index]}`}
              onClick={attention}
            >
              {content}
            </button>
          ) : (
            <div key={label} className={style}>
              {content}
            </div>
          )
        })}
      </div>
      {failed && (
        <p role="alert" className="flex items-center gap-2 text-sm text-danger-ink">
          统计加载失败
          <Button variant="ghost" size="icon" aria-label="重试统计" onClick={retry}>
            <OrderRefreshIcon className="size-4" />
          </Button>
        </p>
      )}
    </section>
  )
}
