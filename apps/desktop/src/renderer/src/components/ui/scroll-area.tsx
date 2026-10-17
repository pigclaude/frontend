// 负责可滚动区域。底层是 shadcn 用的 Radix ScrollArea。
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area"
import type { ComponentProps } from "react"
import { cn } from "../../lib/cn"

/** 包住需要单独滚动的内容。 */
export function ScrollArea({
  className,
  children,
  ...props
}: ComponentProps<typeof ScrollAreaPrimitive.Root>) {
  return (
    <ScrollAreaPrimitive.Root className={cn(className)} {...props}>
      <ScrollAreaPrimitive.Viewport style={{ height: "100%", width: "100%" }}>
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollAreaPrimitive.Scrollbar orientation="vertical">
        <ScrollAreaPrimitive.Thumb />
      </ScrollAreaPrimitive.Scrollbar>
    </ScrollAreaPrimitive.Root>
  )
}
