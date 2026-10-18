// 负责迁入 Pigcursor 成熟后台的sheet组件与交互，保持原有布局和语义。
import * as React from "react"
import { X } from "lucide-react"
import { Dialog as SheetPrimitive } from "radix-ui"
import { cn } from "@pigclaude/web-ui/lib/utils"

/** Sheet 保持后台组件的样式、可访问语义和交互契约。 */
function Sheet(props: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

/** SheetTrigger 保持后台组件的样式、可访问语义和交互契约。 */
function SheetTrigger(props: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

/** SheetClose 保持后台组件的样式、可访问语义和交互契约。 */
function SheetClose(props: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

/** SheetPortal 保持后台组件的样式、可访问语义和交互契约。 */
function SheetPortal(props: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

/** SheetOverlay 保持后台组件的样式、可访问语义和交互契约。 */
function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 z-[80] bg-[var(--backdrop-soft)] backdrop-blur-[3px] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
        className,
      )}
      {...props}
    />
  )
}

/** SheetContent 保持后台组件的样式、可访问语义和交互契约。 */
function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: "top" | "right" | "bottom" | "left"
  showCloseButton?: boolean
}) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          "fixed z-[90] flex flex-col bg-popover text-popover-foreground shadow-[var(--dialog-shadow)] outline-none data-[state=closed]:animate-out data-[state=closed]:duration-200 data-[state=open]:animate-in data-[state=open]:duration-300 data-[state=open]:ease-[cubic-bezier(0.2,0,0,1)]",
          side === "right" &&
            "inset-y-0 right-0 h-full w-full border-l border-border data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-md",
          side === "left" &&
            "inset-y-0 left-0 h-full w-full border-r border-border data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-md",
          side === "top" &&
            "inset-x-0 top-0 h-auto border-b border-border data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
          side === "bottom" &&
            "inset-x-0 bottom-0 h-auto border-t border-border data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close className="absolute top-4 right-4 inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-meta transition-colors outline-none hover:bg-raise-2 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/30">
            <X className="size-4" />
            <span className="sr-only">关闭</span>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Content>
    </SheetPortal>
  )
}

/** SheetHeader 保持后台组件的样式、可访问语义和交互契约。 */
function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-1 border-b border-border-soft px-5 py-4 pr-14", className)}
      {...props}
    />
  )
}

/** SheetFooter 保持后台组件的样式、可访问语义和交互契约。 */
function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn(
        "mt-auto flex flex-col gap-2 border-t border-border-soft bg-popover px-5 py-3.5",
        className,
      )}
      {...props}
    />
  )
}

/** SheetTitle 保持后台组件的样式、可访问语义和交互契约。 */
function SheetTitle({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn(
        "text-base leading-snug font-semibold tracking-[-0.01em] text-foreground",
        className,
      )}
      {...props}
    />
  )
}

/** SheetDescription 保持后台组件的样式、可访问语义和交互契约。 */
function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-[13px] leading-relaxed text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
