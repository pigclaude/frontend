// 负责提供本文件的前端契约、组件或样式实现。
import * as React from "react"
import { Label as LabelPrimitive } from "radix-ui"

import { cn } from "@pigclaude/web-ui/lib/utils"

function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className,
      )}
      {...props}
    />
  )
}

// 导出共享符号，保持包边界稳定。
export { Label }
