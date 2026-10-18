// 负责迁入 Pigcursor 成熟后台的skeleton组件与交互，保持原有布局和语义。
import * as React from "react"
import { cn } from "@pigclaude/web-ui/lib/utils"

/** Skeleton 保持后台组件的样式、可访问语义和交互契约。 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-raise-3", className)}
      {...props}
    />
  )
}

export { Skeleton }
