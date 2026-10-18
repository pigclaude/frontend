// 负责迁入 Pigcursor 成熟后台的dialog组件与交互，保持原有布局和语义。
import * as React from "react"
import { X } from "lucide-react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { cn } from "@pigclaude/web-ui/lib/utils"

/** Dialog 保持后台组件的样式、可访问语义和交互契约。 */
function Dialog(props: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

/** DialogTrigger 保持后台组件的样式、可访问语义和交互契约。 */
function DialogTrigger(props: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

/** DialogPortal 保持后台组件的样式、可访问语义和交互契约。 */
function DialogPortal(props: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

/** DialogClose 保持后台组件的样式、可访问语义和交互契约。 */
function DialogClose(props: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

// 层级：顶栏 z-60、移动端侧栏 z-75、抽屉 z-80/90，对话框统一 z-100/110 压在所有外壳之上
// （抽屉里再弹确认框也能正确叠放）；下拉/提示 z-200。
/** DialogOverlay 保持后台组件的样式、可访问语义和交互契约。 */
function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-[100] bg-[var(--backdrop-soft)] backdrop-blur-[3px] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
        className,
      )}
      {...props}
    />
  )
}

/** DialogContent 保持后台组件的样式、可访问语义和交互契约。 */
function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { showCloseButton?: boolean }) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-[110] grid max-h-[90dvh] w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-5 overflow-y-auto rounded-xl border border-border bg-popover p-6 text-popover-foreground shadow-[var(--dialog-shadow)] outline-none duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-97 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-97 data-[state=open]:slide-in-from-bottom-2 sm:max-w-lg",
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="absolute top-4 right-4 inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-meta transition-colors outline-none hover:bg-raise-2 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/30 disabled:pointer-events-none"
          >
            <X className="size-4" />
            <span className="sr-only">关闭</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

/** DialogHeader 保持后台组件的样式、可访问语义和交互契约。 */
function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-1.5 pr-8 text-left", className)}
      {...props}
    />
  )
}

/** 通栏页脚与弹窗主体同色，顶部分隔线保留操作区域的层次。 */
/** DialogFooter 保持后台组件的样式、可访问语义和交互契约。 */
function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "-mx-6 -mb-6 mt-1 flex flex-col-reverse gap-2 border-t border-border-soft bg-popover px-6 py-3.5 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    />
  )
}

/** DialogTitle 保持后台组件的样式、可访问语义和交互契约。 */
function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "text-base leading-snug font-semibold tracking-[-0.01em] text-foreground",
        className,
      )}
      {...props}
    />
  )
}

/** DialogDescription 保持后台组件的样式、可访问语义和交互契约。 */
function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-[13px] leading-relaxed text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
