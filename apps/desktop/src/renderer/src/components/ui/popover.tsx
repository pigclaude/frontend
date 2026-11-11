// 负责弹出面板。底层使用 Base UI Popover，面板外观沿用 Pigcode 的 popover。
import { Popover as BasePopover } from "@base-ui/react/popover"
import type { ComponentProps, ReactElement } from "react"
import { cn } from "../../lib/cn"

let lastTrigger: HTMLElement | null = null

/** 控制弹出面板的开关。 */
export function Popover(props: ComponentProps<typeof BasePopover.Root>) {
  return <BasePopover.Root {...props} />
}

/** 打开面板的触发元素。 */
export function PopoverTrigger({
  asChild,
  children,
  ...props
}: ComponentProps<typeof BasePopover.Trigger> & { asChild?: boolean }) {
  return (
    <BasePopover.Trigger
      {...props}
      onPointerDown={(event) => {
        lastTrigger = event.currentTarget as HTMLElement
        props.onPointerDown?.(event)
      }}
      onFocus={(event) => {
        lastTrigger = event.currentTarget as HTMLElement
        props.onFocus?.(event)
      }}
      {...(asChild ? { render: children as ReactElement } : {})}
    >
      {asChild ? undefined : children}
    </BasePopover.Trigger>
  )
}

/** 弹出面板本体，默认与触发元素相距 6px，渲染在 portal 里。 */
export function PopoverContent({
  className,
  children,
  side = "bottom",
  sideOffset = 6,
  collisionPadding = 8,
  align,
  onCloseAutoFocus,
  ...props
}: ComponentProps<typeof BasePopover.Popup> &
  Pick<
    ComponentProps<typeof BasePopover.Positioner>,
    "side" | "align" | "sideOffset" | "collisionPadding"
  > & {
    onCloseAutoFocus?: ((event: Event) => void) | undefined
  }) {
  return (
    <BasePopover.Portal>
      <BasePopover.Positioner
        className="menu-positioner"
        side={side}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        {...(align === undefined ? {} : { align })}
      >
        <BasePopover.Popup
          className={cn("popover is-open", className)}
          finalFocus={(closeType) => {
            const event = new Event(`close:${closeType}`, { cancelable: true })
            onCloseAutoFocus?.(event)
            if (event.defaultPrevented) return false
            lastTrigger?.focus()
            return false
          }}
          {...props}
        >
          {children}
        </BasePopover.Popup>
      </BasePopover.Positioner>
    </BasePopover.Portal>
  )
}
