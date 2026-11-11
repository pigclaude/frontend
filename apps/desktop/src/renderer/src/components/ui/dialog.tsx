// 负责模态对话框。底层使用 Base UI Dialog，蒙层和卡片沿用 Pigcode 的 scrim / dialog。
import { Dialog as BaseDialog } from "@base-ui/react/dialog"
import type { ComponentProps, ReactElement } from "react"
import { cn } from "../../lib/cn"

/** 控制对话框开关。 */
export function Dialog(props: ComponentProps<typeof BaseDialog.Root>) {
  return <BaseDialog.Root {...props} />
}

/** 打开对话框的按钮。 */
export function DialogTrigger({
  asChild,
  children,
  ...props
}: ComponentProps<typeof BaseDialog.Trigger> & { asChild?: boolean }) {
  return (
    <BaseDialog.Trigger {...props} {...(asChild ? { render: children as ReactElement } : {})}>
      {asChild ? undefined : children}
    </BaseDialog.Trigger>
  )
}

/** 关闭对话框。 */
export function DialogClose({
  asChild,
  children,
  ...props
}: ComponentProps<typeof BaseDialog.Close> & { asChild?: boolean }) {
  return (
    <BaseDialog.Close {...props} {...(asChild ? { render: children as ReactElement } : {})}>
      {asChild ? undefined : children}
    </BaseDialog.Close>
  )
}

/** 对话框面板，标题和说明由调用方放入。 */
export function DialogContent({
  className,
  children,
  ...props
}: ComponentProps<typeof BaseDialog.Popup>) {
  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop className="scrim" />
      <BaseDialog.Popup
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
      </BaseDialog.Popup>
    </BaseDialog.Portal>
  )
}

/** 对话框标题。 */
export function DialogTitle(props: ComponentProps<typeof BaseDialog.Title>) {
  return <BaseDialog.Title {...props} />
}

/** 对话框说明。 */
export function DialogDescription(props: ComponentProps<typeof BaseDialog.Description>) {
  return <BaseDialog.Description {...props} />
}
