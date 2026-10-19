// 负责迁入 Pigcursor 成熟后台的empty-state组件与交互，保持原有布局和语义。
import * as React from "react"
import { CircleAlert, Inbox, type LucideIcon } from "lucide-react"
import { cn } from "@pigclaude/web-ui/lib/utils"

/**
 * 空态 / 首屏失败态：图标块 + 标题 + 说明 + 操作。tone="danger" 用于「加载失败」，
 * 避免把故障伪装成「暂无数据」。
 */
/** EmptyState 保持后台组件的样式、可访问语义和交互契约。 */
function EmptyState({
  icon,
  title,
  description,
  action,
  tone = "neutral",
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "title"> & {
  icon?: LucideIcon
  title: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
  tone?: "neutral" | "danger"
}) {
  const Icon = icon ?? (tone === "danger" ? CircleAlert : Inbox)
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "flex flex-col items-center justify-center gap-1.5 px-6 py-12 text-center whitespace-normal",
        className,
      )}
      {...props}
    >
      <span
        className={cn(
          "mb-2 flex size-10 items-center justify-center rounded-xl border",
          tone === "danger"
            ? "border-[color-mix(in_oklab,var(--danger),transparent_70%)] bg-[color-mix(in_oklab,var(--danger),transparent_90%)] text-danger-ink"
            : "border-border bg-raise-2 text-meta",
        )}
      >
        <Icon className="size-[18px]" />
      </span>
      <p
        className={cn(
          "text-[13px] font-medium",
          tone === "danger" ? "text-danger-ink" : "text-foreground",
        )}
      >
        {title}
      </p>
      {description && (
        <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-3 flex items-center gap-2">{action}</div>}
    </div>
  )
}

export { EmptyState }
