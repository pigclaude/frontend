// 负责提供本文件的前端契约、组件或样式实现。
import { cn } from "@pigclaude/web-ui/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-accent-ui", className)}
      {...props}
    />
  )
}

// 导出共享符号，保持包边界稳定。
export { Skeleton }
