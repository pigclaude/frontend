// 负责下拉菜单。底层使用 Base UI Menu，菜单外观用 Pigcode 的 popover。
import { Menu as BaseMenu } from "@base-ui/react/menu"
import {
  createContext,
  useContext,
  useId,
  useState,
  type ComponentProps,
  type ReactElement,
} from "react"
import { cn } from "../../lib/cn"

type MenuChangeDetails = Parameters<
  NonNullable<ComponentProps<typeof BaseMenu.Root>["onOpenChange"]>
>[1]
type MenuState = { triggerId: string; setOpen: (open: boolean) => void }
const MenuStateContext = createContext<MenuState | null>(null)

/** 控制菜单开关。 */
export function DropdownMenu({
  open,
  onOpenChange,
  children,
  ...props
}: ComponentProps<typeof BaseMenu.Root>) {
  const [internalOpen, setInternalOpen] = useState(false)
  const triggerId = useId()
  const controlled = open !== undefined
  const actualOpen = controlled ? open : internalOpen
  const setOpen = (next: boolean, details?: MenuChangeDetails) => {
    if (!controlled) setInternalOpen(next)
    if (details) onOpenChange?.(next, details)
  }
  return (
    <MenuStateContext.Provider value={{ triggerId, setOpen }}>
      <BaseMenu.Root
        {...props}
        open={actualOpen}
        triggerId={triggerId}
        onOpenChange={(next, details) => setOpen(next, details)}
      >
        {children}
      </BaseMenu.Root>
    </MenuStateContext.Provider>
  )
}

/** 打开菜单的按钮。 */
export function DropdownMenuTrigger({
  asChild,
  children,
  ...props
}: ComponentProps<typeof BaseMenu.Trigger> & { asChild?: boolean }) {
  const menu = useContext(MenuStateContext)
  return (
    <BaseMenu.Trigger
      {...props}
      {...(menu && props.id === undefined ? { id: menu.triggerId } : {})}
      onPointerDown={(event) => {
        props.onPointerDown?.(event)
        menu?.setOpen(true)
        queueMicrotask(() => queueMicrotask(() => menu?.setOpen(true)))
        setTimeout(() => menu?.setOpen(true), 0)
      }}
      onClick={(event) => {
        props.onClick?.(event)
        menu?.setOpen(true)
        queueMicrotask(() => queueMicrotask(() => menu?.setOpen(true)))
        setTimeout(() => menu?.setOpen(true), 0)
      }}
      onKeyDown={(event) => {
        props.onKeyDown?.(event)
        if (!event.defaultPrevented && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault()
          menu?.setOpen(true)
        }
      }}
      {...(asChild ? { render: children as ReactElement } : {})}
    >
      {asChild ? undefined : children}
    </BaseMenu.Trigger>
  )
}

/** 菜单面板。 */
export function DropdownMenuContent({
  className,
  side = "bottom",
  sideOffset = 6,
  collisionPadding = 8,
  align,
  children,
  ...props
}: ComponentProps<typeof BaseMenu.Popup> &
  Pick<
    ComponentProps<typeof BaseMenu.Positioner>,
    "side" | "align" | "sideOffset" | "collisionPadding"
  >) {
  return (
    <BaseMenu.Portal>
      <BaseMenu.Positioner
        className="menu-positioner"
        side={side}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        {...(align === undefined ? {} : { align })}
      >
        <BaseMenu.Popup className={cn("popover is-open", className)} {...props}>
          {children}
        </BaseMenu.Popup>
      </BaseMenu.Positioner>
    </BaseMenu.Portal>
  )
}

/** 菜单里的一项。 */
export function DropdownMenuItem({
  className,
  onSelect,
  ...props
}: ComponentProps<typeof BaseMenu.Item> & { onSelect?: (() => void) | undefined }) {
  return (
    <BaseMenu.Item
      className={cn("menu-item", className)}
      {...props}
      {...(onSelect === undefined ? {} : { onClick: onSelect })}
    />
  )
}

/** 菜单分组标题。 */
export function DropdownMenuLabel({
  className,
  ...props
}: ComponentProps<typeof BaseMenu.GroupLabel>) {
  return <BaseMenu.GroupLabel className={cn("menu-label", className)} {...props} />
}

/** 菜单分隔线。 */
export function DropdownMenuSeparator(props: ComponentProps<typeof BaseMenu.Separator>) {
  return <BaseMenu.Separator className="menu-sep" {...props} />
}
