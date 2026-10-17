// 负责下拉选择。底层是 shadcn 用的 Radix Select，触发器沿用设计稿的 select 外观。
import * as SelectPrimitive from "@radix-ui/react-select"
import type { ComponentProps } from "react"
import { cn } from "../../lib/cn"
import { Icon } from "../icon"

/** 控制选择器的取值与开关。 */
export function Select(props: ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root {...props} />
}

/** 选项分组。 */
export function SelectGroup(props: ComponentProps<typeof SelectPrimitive.Group>) {
  return <SelectPrimitive.Group {...props} />
}

/** 在触发器里显示当前选中项。 */
export function SelectValue(props: ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value {...props} />
}

/** 打开选项列表的触发器，右侧箭头由样式的 ::after 绘制。 */
export function SelectTrigger({
  className,
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger className={cn("select-trigger", className)} {...props}>
      <span className="select-trigger-value">{children}</span>
    </SelectPrimitive.Trigger>
  )
}

/** 选项列表面板，宽度不小于触发器。 */
export function SelectContent({
  className,
  children,
  position = "popper",
  sideOffset = 6,
  collisionPadding = 8,
  ...props
}: ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        position={position}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn("popover is-open select-content", className)}
        {...props}
      >
        <SelectPrimitive.Viewport className="select-viewport">{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}

/** 一个可选项，选中时右侧显示对勾。 */
export function SelectItem({
  className,
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item className={cn("menu-item select-item", className)} {...props}>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="check-mark">
        <Icon name="check" small />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  )
}

/** 选项分组标题。 */
export function SelectLabel({ className, ...props }: ComponentProps<typeof SelectPrimitive.Label>) {
  return <SelectPrimitive.Label className={cn("menu-label", className)} {...props} />
}

/** 选项分隔线。 */
export function SelectSeparator({
  className,
  ...props
}: ComponentProps<typeof SelectPrimitive.Separator>) {
  return <SelectPrimitive.Separator className={cn("menu-sep", className)} {...props} />
}
