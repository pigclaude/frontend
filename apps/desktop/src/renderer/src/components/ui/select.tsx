// 负责下拉选择。底层使用 Base UI Select，触发器和选项沿用 Pigcode 的菜单样式。
import { Select as BaseSelect } from "@base-ui/react/select"
import { Children, isValidElement, type ComponentProps, type ReactNode } from "react"
import { cn } from "../../lib/cn"
import { Icon } from "../icon"

type SelectProps = Omit<
  ComponentProps<typeof BaseSelect.Root<string>>,
  "value" | "defaultValue" | "onValueChange"
> & {
  value?: string | null
  defaultValue?: string | null
  onValueChange?: ((value: string) => void) | undefined
}

function collectItems(children: ReactNode): Record<string, ReactNode> {
  const items: Record<string, ReactNode> = {}
  for (const child of Children.toArray(children)) {
    if (!isValidElement(child)) continue
    const childProps = child.props as { value?: unknown; children?: ReactNode }
    if (child.type === SelectItem && typeof childProps.value === "string") {
      items[childProps.value] = childProps.children
      continue
    }
    if (childProps.children !== undefined) Object.assign(items, collectItems(childProps.children))
  }
  return items
}

/** 控制选择器的取值与开关；桌面端所有选项均为字符串。 */
export function Select({ onValueChange, children, items, ...props }: SelectProps) {
  return (
    <BaseSelect.Root<string>
      key={props.value ?? "__empty__"}
      items={items ?? collectItems(children)}
      {...props}
      {...(onValueChange === undefined
        ? {}
        : {
            onValueChange: (value) => {
              if (value !== null) onValueChange(value)
            },
          })}
    >
      {children}
    </BaseSelect.Root>
  )
}

/** 选项分组。 */
export function SelectGroup(props: ComponentProps<typeof BaseSelect.Group>) {
  return <BaseSelect.Group {...props} />
}

/** 在触发器里显示当前选中项。 */
export function SelectValue(props: ComponentProps<typeof BaseSelect.Value>) {
  return <BaseSelect.Value {...props} />
}

/** 打开选项列表的触发器。 */
export function SelectTrigger({
  className,
  children,
  ...props
}: ComponentProps<typeof BaseSelect.Trigger>) {
  return (
    <BaseSelect.Trigger className={cn("select-trigger", className)} {...props}>
      <span className="select-trigger-value">{children}</span>
    </BaseSelect.Trigger>
  )
}

/** 选项列表面板，宽度不小于触发器。 */
export function SelectContent({
  className,
  children,
  position: _position,
  side = "bottom",
  sideOffset = 6,
  collisionPadding = 8,
  align,
  onCloseAutoFocus: _onCloseAutoFocus,
  ...props
}: ComponentProps<typeof BaseSelect.Popup> &
  Pick<
    ComponentProps<typeof BaseSelect.Positioner>,
    "side" | "align" | "sideOffset" | "collisionPadding"
  > & {
    position?: "popper" | "item-aligned"
    onCloseAutoFocus?: ((event: Event) => void) | undefined
  }) {
  void _position
  return (
    <BaseSelect.Portal>
      <BaseSelect.Positioner
        className="menu-positioner"
        side={side}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        {...(align === undefined ? {} : { align })}
      >
        <BaseSelect.Popup
          className={cn("popover is-open select-content", className)}
          finalFocus={(closeType) => {
            const event = new Event(`close:${closeType}`, { cancelable: true })
            _onCloseAutoFocus?.(event)
            return event.defaultPrevented ? false : true
          }}
          {...props}
        >
          <BaseSelect.List className="select-viewport">{children}</BaseSelect.List>
        </BaseSelect.Popup>
      </BaseSelect.Positioner>
    </BaseSelect.Portal>
  )
}

/** 一个可选项，选中时右侧显示对勾。 */
export function SelectItem({
  className,
  children,
  id,
  ...props
}: ComponentProps<typeof BaseSelect.Item> & { id?: string }) {
  return (
    <BaseSelect.Item
      className={cn("menu-item select-item", className)}
      {...(id === undefined ? {} : { id })}
      {...props}
    >
      <BaseSelect.ItemText>{children}</BaseSelect.ItemText>
      <BaseSelect.ItemIndicator className="check-mark">
        <Icon name="check" small />
      </BaseSelect.ItemIndicator>
    </BaseSelect.Item>
  )
}

/** 选项分组标题。 */
export function SelectLabel({ className, ...props }: ComponentProps<typeof BaseSelect.GroupLabel>) {
  return <BaseSelect.GroupLabel className={cn("menu-label", className)} {...props} />
}

/** 选项分隔线。 */
export function SelectSeparator({
  className,
  ...props
}: ComponentProps<typeof BaseSelect.Separator>) {
  return <BaseSelect.Separator className={cn("menu-sep", className)} {...props} />
}
