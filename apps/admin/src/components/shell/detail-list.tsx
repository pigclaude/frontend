// 负责迁入原后台用户列表与只读详情的布局、表格密度和交互。
import type { ReactNode } from "react"
import { cn } from "@pigclaude/web-ui/lib/utils"

/** 抽屉/详情里的键值清单：圆角描边卡片，行间细分隔，键左值右。 */
/** DetailList 保持用户摘要展示与可访问交互。 */
export function DetailList({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <dl
      className={cn(
        "divide-y divide-border-soft rounded-lg border border-border bg-[var(--card-bg)] px-3.5",
        className,
      )}
    >
      {children}
    </dl>
  )
}

/** DetailRow 保持用户摘要展示与可访问交互。 */
export function DetailRow({
  label,
  children,
  mono = false,
}: {
  label: ReactNode
  children: ReactNode
  mono?: boolean
}) {
  return (
    <div className="flex items-start justify-between gap-6 py-2.5 text-[13px]">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "min-w-0 text-right break-all text-foreground",
          mono && "font-mono text-xs leading-5",
        )}
      >
        {children}
      </dd>
    </div>
  )
}
