// 负责模态对话框。底层是 shadcn 用的 Radix Dialog，蒙层和卡片用设计稿的 scrim / dialog。
import * as DialogPrimitive from "@radix-ui/react-dialog"
import type { ComponentProps } from "react"
import { cn } from "../../lib/cn"

/** 控制对话框开关。 */
export function Dialog(props: ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root {...props} />
}

/** 打开对话框的按钮。 */
export function DialogTrigger(props: ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger {...props} />
}

/** 关闭对话框。 */
export function DialogClose(props: ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close {...props} />
}

/** 对话框面板，标题和说明由调用方放入。 */
export function DialogContent({
  className,
  children,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="scrim" />
      <DialogPrimitive.Content
        className={cn("dialog", className)}
        style={{
          position: "fixed",
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          zIndex: 81,
        }}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

/** 对话框标题。 */
export function DialogTitle(props: ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title {...props} />
}

/** 对话框说明。 */
export function DialogDescription(props: ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description {...props} />
}
