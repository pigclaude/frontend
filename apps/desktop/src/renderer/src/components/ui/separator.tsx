// 负责分隔线。底层使用 Base UI Separator。
import { Separator as BaseSeparator } from "@base-ui/react/separator"
import type { ComponentProps } from "react"
import { cn } from "../../lib/cn"

/** 渲染水平或垂直的分隔线，默认水平且仅作装饰。 */
export function Separator({
  className,
  orientation = "horizontal",
  decorative: _decorative,
  ...props
}: ComponentProps<typeof BaseSeparator> & { decorative?: boolean }) {
  void _decorative
  return (
    <BaseSeparator orientation={orientation} className={cn("ui-separator", className)} {...props} />
  )
}
