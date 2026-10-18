// 负责迁入 Pigcursor 成熟后台的tooltip组件与交互，保持原有布局和语义。
import * as React from "react"
import { Tooltip as TooltipPrimitive } from "radix-ui"
import { cn } from "@pigclaude/web-ui/lib/utils"

/** TooltipProvider 保持后台组件的样式、可访问语义和交互契约。 */
function TooltipProvider({
  delayDuration = 200,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  )
}

/** Tooltip 保持后台组件的样式、可访问语义和交互契约。 */
function Tooltip(props: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
}

/** TooltipTrigger 保持后台组件的样式、可访问语义和交互契约。 */
function TooltipTrigger(props: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

/** TooltipContent 保持后台组件的样式、可访问语义和交互契约。 */
function TooltipContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "z-[200] w-fit origin-(--radix-tooltip-content-transform-origin) rounded-md border border-border bg-popover px-2 py-1 text-xs font-medium text-foreground shadow-[var(--menu-shadow)] animate-in fade-in-0 zoom-in-97 data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-97",
          className,
        )}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
