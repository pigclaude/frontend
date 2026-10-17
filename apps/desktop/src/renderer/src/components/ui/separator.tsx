// 负责分隔线。底层是 shadcn 用的 Radix Separator。
import * as SeparatorPrimitive from "@radix-ui/react-separator"
import type { ComponentProps } from "react"
import { cn } from "../../lib/cn"

/** 渲染水平或垂直的分隔线，默认水平且仅作装饰。 */
export function Separator({
  className,
  orientation = "horizontal",
  decorative = true,
  ...props
}: ComponentProps<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      orientation={orientation}
      decorative={decorative}
      className={cn("ui-separator", className)}
      {...props}
    />
  )
}
