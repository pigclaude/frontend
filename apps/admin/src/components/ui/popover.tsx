// 负责提供后台弹出层的定位、焦点管理和门户样式。
import type { ComponentProps } from "react"
import { Popover as Primitive } from "radix-ui"
import { cn } from "@pigclaude/web-ui/lib/utils"
/** 保留 Radix 弹出层的受控开关协议。 */
export function Popover(props: ComponentProps<typeof Primitive.Root>) {
  return <Primitive.Root {...props} />
}
/** 将触发控件与弹出层关联。 */
export function PopoverTrigger(props: ComponentProps<typeof Primitive.Trigger>) {
  return <Primitive.Trigger {...props} />
}
/** 提供门户层与一致的菜单视觉。 */
export function PopoverContent({ className, ...props }: ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        sideOffset={4}
        align="start"
        className={cn(
          "z-[210] w-80 rounded-lg border border-border bg-popover p-2 text-popover-foreground shadow-lg",
          className,
        )}
        {...props}
      />
    </Primitive.Portal>
  )
}
