// 负责迁入成熟后台的pager布局和交互，使用本项目真实 API。
import type { ReactNode } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"

interface PagerProps {
  page: number
  hasPrev: boolean
  hasNext: boolean
  onPrev: () => void
  onNext: () => void
}

/** 游标分页控件：总数未知，只显示当前页码 + 上一页 / 下一页。 */
/** Pager 保持列表、表单或分页的既有交互契约。 */
export function Pager({ page, hasPrev, hasNext, onPrev, onNext }: PagerProps) {
  return (
    <div className="flex items-center gap-1.5">
      <Button size="sm" variant="outline" disabled={!hasPrev} onClick={onPrev} className="pl-1.5">
        <ChevronLeft />
        上一页
      </Button>
      <span className="min-w-[56px] text-center text-xs text-muted-foreground tabular-nums">
        第 {page} 页
      </span>
      <Button size="sm" variant="outline" disabled={!hasNext} onClick={onNext} className="pr-1.5">
        下一页
        <ChevronRight />
      </Button>
    </div>
  )
}

type PagerSource = {
  isError?: boolean
  retry?: () => void
  items: unknown[]
  page: number
  hasPrev: boolean
  hasNext: boolean
  prev: () => void
  next: () => void
}

/** TableCard 页脚：左「本页 N {noun}」（或错误提示 hint）、右分页。 */
/** PagerFooter 保持列表、表单或分页的既有交互契约。 */
export function PagerFooter({
  pager,
  noun,
  hint,
}: {
  pager: PagerSource
  noun: string
  hint?: ReactNode
}) {
  return (
    <>
      {hint ??
        (pager.isError ? (
          <span role="alert" className="flex items-center gap-2 text-danger-ink">
            加载失败
            <Button size="sm" variant="outline" onClick={pager.retry}>
              重试
            </Button>
          </span>
        ) : (
          <span className="tabular-nums">
            本页 {pager.items.length} {noun}
          </span>
        ))}
      <Pager
        page={pager.page}
        hasPrev={pager.hasPrev}
        hasNext={pager.hasNext}
        onPrev={pager.prev}
        onNext={pager.next}
      />
    </>
  )
}
