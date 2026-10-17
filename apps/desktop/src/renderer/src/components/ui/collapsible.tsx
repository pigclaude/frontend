// 负责折叠区。底层是 shadcn 用的 Radix Collapsible。
import * as CollapsiblePrimitive from "@radix-ui/react-collapsible"
import type { ComponentProps } from "react"
import { cn } from "../../lib/cn"

/** 控制折叠区的展开与收起。 */
export function Collapsible(props: ComponentProps<typeof CollapsiblePrimitive.Root>) {
  return <CollapsiblePrimitive.Root {...props} />
}

/** 切换折叠区的触发元素。 */
export function CollapsibleTrigger(props: ComponentProps<typeof CollapsiblePrimitive.Trigger>) {
  return <CollapsiblePrimitive.Trigger {...props} />
}

/** 折叠区里被展开或收起的内容。 */
export function CollapsibleContent({
  className,
  ...props
}: ComponentProps<typeof CollapsiblePrimitive.Content>) {
  return (
    <CollapsiblePrimitive.Content className={cn("collapsible-content", className)} {...props} />
  )
}
