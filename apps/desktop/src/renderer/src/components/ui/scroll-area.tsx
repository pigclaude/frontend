// 负责可滚动区域。底层使用 Base UI ScrollArea。
import { ScrollArea as BaseScrollArea } from "@base-ui/react/scroll-area"
import type { ComponentProps } from "react"
import { cn } from "../../lib/cn"

/** 包住需要单独滚动的内容。 */
export function ScrollArea({
  className,
  children,
  ...props
}: ComponentProps<typeof BaseScrollArea.Root>) {
  return (
    <BaseScrollArea.Root className={cn(className)} {...props}>
      <BaseScrollArea.Viewport style={{ height: "100%", width: "100%" }}>
        {children}
      </BaseScrollArea.Viewport>
      <BaseScrollArea.Scrollbar orientation="vertical">
        <BaseScrollArea.Thumb />
      </BaseScrollArea.Scrollbar>
    </BaseScrollArea.Root>
  )
}
