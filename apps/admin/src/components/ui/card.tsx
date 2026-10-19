// 负责迁入固定 Pigcursor 管理后台专用卡片实体，保持来源布局和语义。
import * as React from "react"
import { cn } from "@pigclaude/web-ui/lib/utils"

/** 卡片容器保留管理后台专用背景、最小宽度和紧凑边框。 */
function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn(
        "flex min-w-0 flex-col rounded-xl border border-border bg-[var(--card-bg)] text-card-foreground shadow-[var(--card-shadow)]",
        className,
      )}
      {...props}
    />
  )
}

/** 卡片头保留管理后台五单位内边距和分隔线下留白。 */
function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "grid auto-rows-min grid-rows-[auto_auto] items-start gap-1 px-5 pt-5 has-data-[slot=card-action]:grid-cols-[1fr_auto] [.border-b]:pb-4",
        className,
      )}
      {...props}
    />
  )
}

/** 卡片标题保留管理后台字号、字重和颜色。 */
function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn(
        "text-[15px] leading-snug font-semibold tracking-[-0.01em] text-foreground",
        className,
      )}
      {...props}
    />
  )
}

/** 卡片说明保留管理后台字号和次要文字颜色。 */
function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-[13px] text-muted-foreground", className)}
      {...props}
    />
  )
}

/** 卡片操作区保持标题旁的网格位置。 */
function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn("col-start-2 row-span-2 row-start-1 self-start justify-self-end", className)}
      {...props}
    />
  )
}

/** 卡片内容保持管理后台统一内边距。 */
function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-content" className={cn("p-5", className)} {...props} />
}

/** 卡片底栏保留分隔线、背景和紧凑内边距。 */
function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "flex items-center gap-3 rounded-b-xl border-t border-border-soft bg-raise-1 px-5 py-3",
        className,
      )}
      {...props}
    />
  )
}

export { Card, CardHeader, CardFooter, CardTitle, CardAction, CardDescription, CardContent }
