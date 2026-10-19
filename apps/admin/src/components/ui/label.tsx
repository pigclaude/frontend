// 负责迁入 Pigcursor 成熟后台的label组件与交互，保持原有布局和语义。
import * as React from "react"
import { Label as LabelPrimitive } from "radix-ui"
import { cn } from "@pigclaude/web-ui/lib/utils"

/** Label 保持后台组件的样式、可访问语义和交互契约。 */
function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-[13px] leading-none font-medium text-fg-2 select-none peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className,
      )}
      {...props}
    />
  )
}

export { Label }
