// 负责后台行内错误的标准提示容器。
import type { ComponentProps } from "react"
import { cn } from "@pigclaude/web-ui/lib/utils"
/** 错误容器保留 alert 可访问语义。 */
export function Alert({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      role="alert"
      data-slot="alert"
      className={cn(
        "rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm",
        className,
      )}
      {...props}
    />
  )
}
