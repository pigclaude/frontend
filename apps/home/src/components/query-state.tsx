// 负责提供 home 查询的加载、空数据、错误和重试展示语义。
import { Skeleton } from "@pigclaude/web-ui/components/skeleton"
import { Button } from "@pigclaude/web-ui/components/button"

/** 展示查询加载状态。 */
export function QueryLoading({ label = "加载中…" }: { label?: string }) {
  return (
    <div role="status" aria-label={label} className="query-state space-y-3">
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-20 w-full" />
    </div>
  )
}

/** 展示空数据状态。 */
export function QueryEmpty({ label }: { label: string }) {
  return <p className="query-state">{label}</p>
}

/** 展示错误和显式重试按钮。 */
export function QueryError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const message = error instanceof Error ? error.message : "请求失败，请稍后重试"
  return (
    <div role="alert" className="query-error">
      <p>{message}</p>
      <Button type="button" variant="outline" onClick={onRetry}>
        重试
      </Button>
    </div>
  )
}
