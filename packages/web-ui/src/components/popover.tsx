// 负责提供基于 Radix 的 shadcn 弹出层、触发器和定位内容。
"use client"
import type { ComponentProps } from "react"
import { Popover as Primitive } from "radix-ui"
import { cn } from "../lib/utils"

/** 提供受控或非受控弹出层状态。 */
export function Popover(props: ComponentProps<typeof Primitive.Root>) {
  return <Primitive.Root {...props} />
}
/** 保留 Radix 键盘、焦点和展开语义。 */
export function PopoverTrigger(props: ComponentProps<typeof Primitive.Trigger>) {
  return <Primitive.Trigger data-slot="popover-trigger" {...props} />
}
/** 以 Portal 呈现避让视口边缘的弹出内容，并在关闭后还原焦点。 */
export function PopoverContent({
  className,
  align = "center",
  sideOffset = 4,
  ...props
}: ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 w-80 rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-lg outline-none",
          className,
        )}
        {...props}
      />
    </Primitive.Portal>
  )
}
/** 提供可选的弹出定位锚点。 */
export function PopoverAnchor(props: ComponentProps<typeof Primitive.Anchor>) {
  return <Primitive.Anchor data-slot="popover-anchor" {...props} />
}
