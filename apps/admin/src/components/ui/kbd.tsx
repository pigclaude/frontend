// 负责迁入 Pigcursor 成熟后台的kbd组件与交互，保持原有布局和语义。
import * as React from "react"
import { cn } from "@pigclaude/web-ui/lib/utils"

/** Kbd 保持后台组件的样式、可访问语义和交互契约。 */
function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-[4px] border border-border bg-raise-2 px-1 font-sans text-[10.5px] font-medium text-muted-foreground",
        className,
      )}
      {...props}
    />
  )
}

export { Kbd }
