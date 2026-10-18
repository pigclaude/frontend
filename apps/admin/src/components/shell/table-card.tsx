// 负责迁入 Pigcursor 成熟后台的table-card组件与交互，保持原有布局和语义。
import type { ReactNode } from "react"
import { cn } from "@pigclaude/web-ui/lib/utils"

interface TableCardProps {
  toolbar?: ReactNode
  footer?: ReactNode
  children: ReactNode
  className?: string
}

/**
 * 列表页通用骨架：工具栏（标题/搜索/筛选槽位）+ 表体 + 卡片脚（左计数右分页槽位）。
 * padding 0、overflow hidden，让内部 <Table> 的表头底色/分隔线贴合卡片圆角。
 * 工具栏内的搜索框与下拉给默认宽度，页面无需逐个声明。
 */
/** TableCard 保持后台组件的样式、可访问语义和交互契约。 */
export function TableCard({ toolbar, footer, children, className }: TableCardProps) {
  return (
    <div
      className={cn(
        "min-w-0 overflow-hidden rounded-xl border border-border bg-[var(--card-bg)] shadow-[var(--card-shadow)]",
        className,
      )}
    >
      {toolbar && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border-soft px-5 py-3 [&_[data-slot=input]]:sm:w-[240px] [&_[data-slot=search-input]]:sm:w-[280px] [&_[data-slot=search-input]_[data-slot=input]]:w-full [&_[data-slot=select-trigger]]:min-w-[132px]">
          {toolbar}
        </div>
      )}
      {children}
      {footer && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-soft px-5 py-2.5 text-xs text-muted-foreground">
          {footer}
        </div>
      )}
    </div>
  )
}

/** 工具栏左侧的区块标题 + 说明（右侧放筛选控件时自动 mr-auto 顶开）。 */
/** ToolbarTitle 保持后台组件的样式、可访问语义和交互契约。 */
export function ToolbarTitle({ title, hint }: { title: string; hint?: ReactNode }) {
  return (
    <div className="mr-auto min-w-0 py-0.5">
      <h3 className="text-sm font-semibold tracking-[-0.01em] text-foreground">{title}</h3>
      {hint && <p className="mt-0.5 text-xs text-meta">{hint}</p>}
    </div>
  )
}
