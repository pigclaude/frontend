// 负责折叠区。底层使用 Pigcode 采用的 Base UI Collapsible。
import { Collapsible as BaseCollapsible } from "@base-ui/react/collapsible"
import type { ComponentProps, ReactElement } from "react"
import { cn } from "../../lib/cn"

/** 控制折叠区的展开与收起。 */
export function Collapsible(props: ComponentProps<typeof BaseCollapsible.Root>) {
  return <BaseCollapsible.Root {...props} />
}

/** 切换折叠区的触发元素。 */
export function CollapsibleTrigger({
  asChild,
  children,
  ...props
}: ComponentProps<typeof BaseCollapsible.Trigger> & { asChild?: boolean }) {
  return (
    <BaseCollapsible.Trigger {...props} {...(asChild ? { render: children as ReactElement } : {})}>
      {asChild ? undefined : children}
    </BaseCollapsible.Trigger>
  )
}

/** 折叠区里被展开或收起的内容。 */
export function CollapsibleContent({
  className,
  ...props
}: ComponentProps<typeof BaseCollapsible.Panel>) {
  return <BaseCollapsible.Panel className={cn("collapsible-content", className)} {...props} />
}
