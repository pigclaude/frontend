// 负责表单标签。使用原生 label 保持 Base UI 表单的关联行为。
import type { ComponentProps } from "react"
import { cn } from "../../lib/cn"

/** 渲染与控件关联的标签，点击会聚焦对应控件。 */
export function Label({ className, ...props }: ComponentProps<"label">) {
  return <label className={cn("ui-label", className)} {...props} />
}
