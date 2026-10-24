// 为会员报价读取提供无裸露加载文字的骨架。
import { Skeleton } from "@pigclaude/web-ui/components/skeleton"
/** 使用可访问状态标识和与正文相同的两栏占位等待报价。 */
export function MembershipSkeleton() {
  return (
    <main className="page-shell membership-page" role="status" aria-label="正在读取会员信息">
      <Skeleton className="h-10 w-32" />
      <div className="membership-layout" data-aside="true">
        <div className="membership-main">
          <div className="grid gap-4 sm:grid-cols-2">
            <Skeleton className="h-44" />
            <Skeleton className="h-44" />
          </div>
          <Skeleton className="h-32" />
        </div>
        <div className="membership-aside">
          <Skeleton className="h-72" />
        </div>
      </div>
    </main>
  )
}
