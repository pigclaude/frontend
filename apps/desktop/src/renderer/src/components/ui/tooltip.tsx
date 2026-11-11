// 负责悬停提示。底层使用 Base UI Tooltip。
import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip"
import type { ComponentProps, ReactElement } from "react"
import { cn } from "../../lib/cn"

/** 包住需要悬停说明的区域。 */
export function TooltipProvider(props: ComponentProps<typeof BaseTooltip.Provider>) {
  return <BaseTooltip.Provider delay={400} {...props} />
}

/** 一个提示的触发和内容。 */
export function Tooltip(props: ComponentProps<typeof BaseTooltip.Root>) {
  return <BaseTooltip.Root {...props} />
}

/** 触发提示的元素。 */
export function TooltipTrigger({
  asChild,
  children,
  ...props
}: ComponentProps<typeof BaseTooltip.Trigger> & { asChild?: boolean }) {
  return (
    <BaseTooltip.Trigger {...props} {...(asChild ? { render: children as ReactElement } : {})}>
      {asChild ? undefined : children}
    </BaseTooltip.Trigger>
  )
}

/** 提示气泡，默认出现在触发元素上方。 */
export function TooltipContent({
  className,
  side = "top",
  align,
  ...props
}: ComponentProps<typeof BaseTooltip.Popup> & {
  side?: "top" | "bottom" | "left" | "right"
  align?: "start" | "center" | "end"
}) {
  return (
    <BaseTooltip.Portal>
      <BaseTooltip.Positioner side={side} {...(align === undefined ? {} : { align })}>
        <BaseTooltip.Popup className={cn("popover is-open", className)} {...props} />
      </BaseTooltip.Positioner>
    </BaseTooltip.Portal>
  )
}
