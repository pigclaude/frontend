// 负责表单标签。底层是 shadcn 用的 Radix Label。
import * as LabelPrimitive from "@radix-ui/react-label"
import type { ComponentProps } from "react"
import { cn } from "../../lib/cn"

/** 渲染与控件关联的标签，点击会聚焦对应控件。 */
export function Label({ className, ...props }: ComponentProps<typeof LabelPrimitive.Root>) {
  return <LabelPrimitive.Root className={cn("ui-label", className)} {...props} />
}
