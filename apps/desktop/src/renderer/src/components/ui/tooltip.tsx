// 负责悬停提示。底层是 shadcn 用的 Radix Tooltip。
import * as TooltipPrimitive from "@radix-ui/react-tooltip"
import type { ComponentProps } from "react"
import { cn } from "../../lib/cn"

/** 包住需要悬停说明的区域。 */
export function TooltipProvider(props: ComponentProps<typeof TooltipPrimitive.Provider>) {
  return <TooltipPrimitive.Provider delayDuration={400} {...props} />
}

/** 一个提示的触发和内容。 */
export function Tooltip(props: ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root {...props} />
}

/** 触发提示的元素。 */
export function TooltipTrigger(props: ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger {...props} />
}

/** 提示气泡，默认出现在触发元素上方。 */
export function TooltipContent({
  className,
  side = "top",
  ...props
}: ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        side={side}
        className={cn("popover is-open", className)}
        style={{ position: "fixed" }}
        {...props}
      />
    </TooltipPrimitive.Portal>
  )
}
