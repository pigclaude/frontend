// 负责弹出面板。底层是 shadcn 用的 Radix Popover，面板外观沿用设计稿的 popover。
import * as PopoverPrimitive from "@radix-ui/react-popover"
import type { ComponentProps } from "react"
import { cn } from "../../lib/cn"

/** 控制弹出面板的开关。 */
export function Popover(props: ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root {...props} />
}

/** 打开面板的触发元素。 */
export function PopoverTrigger(props: ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger {...props} />
}

/** 弹出面板本体，默认与触发元素相距 6px，渲染在 portal 里。 */
export function PopoverContent({
  className,
  sideOffset = 6,
  collisionPadding = 8,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn("popover is-open", className)}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}
