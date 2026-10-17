// 负责分段切换。底层是 shadcn 用的 Radix ToggleGroup，外观沿用设计稿的 seg。
import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group"
import type { ComponentProps } from "react"
import { cn } from "../../lib/cn"

/** 一组互斥或可多选的切换按钮，选中态由 data-state=on 表示。 */
export function ToggleGroup({
  className,
  ...props
}: ComponentProps<typeof ToggleGroupPrimitive.Root>) {
  return <ToggleGroupPrimitive.Root className={cn("seg", className)} {...props} />
}

/** 切换组里的一项。 */
export function ToggleGroupItem({
  className,
  ...props
}: ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  return <ToggleGroupPrimitive.Item className={cn("seg-item", className)} {...props} />
}
