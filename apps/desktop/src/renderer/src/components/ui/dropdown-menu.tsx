// 负责下拉菜单。底层是 shadcn 用的 Radix DropdownMenu，菜单外观用设计稿的 popover。
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu"
import type { ComponentProps } from "react"
import { cn } from "../../lib/cn"

/** 控制菜单开关。 */
export function DropdownMenu(props: ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root {...props} />
}

/** 打开菜单的按钮。 */
export function DropdownMenuTrigger(props: ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return <DropdownMenuPrimitive.Trigger {...props} />
}

/** 菜单面板。 */
export function DropdownMenuContent({
  className,
  side = "bottom",
  sideOffset = 6,
  collisionPadding = 8,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        side={side}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn("popover is-open", className)}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  )
}

/** 菜单里的一项。 */
export function DropdownMenuItem({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Item>) {
  return <DropdownMenuPrimitive.Item className={cn("menu-item", className)} {...props} />
}

/** 菜单分组标题。 */
export function DropdownMenuLabel({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Label>) {
  return <DropdownMenuPrimitive.Label className={cn("menu-label", className)} {...props} />
}

/** 菜单分隔线。 */
export function DropdownMenuSeparator(
  props: ComponentProps<typeof DropdownMenuPrimitive.Separator>,
) {
  return <DropdownMenuPrimitive.Separator className="menu-sep" {...props} />
}
