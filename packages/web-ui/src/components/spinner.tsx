// 负责提供本文件的前端契约、组件或样式实现。
import { Loader2Icon } from "lucide-react"

import { cn } from "@pigclaude/web-ui/lib/utils"

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <Loader2Icon
      role="status"
      aria-label="Loading"
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  )
}

// 导出共享符号，保持包边界稳定。
export { Spinner }
