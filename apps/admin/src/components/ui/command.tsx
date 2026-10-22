// 负责为服务器搜索结果保留 cmdk 的键盘导航和可访问语义。
import type { ComponentProps } from "react"
import { Command as Primitive } from "cmdk"
import { cn } from "@pigclaude/web-ui/lib/utils"
/** 服务器过滤结果，不在浏览器再次按显示名称过滤。 */
export function Command(props: ComponentProps<typeof Primitive>) {
  return <Primitive shouldFilter={false} {...props} />
}
/** 提供可访问的搜索输入。 */
export function CommandInput(props: ComponentProps<typeof Primitive.Input>) {
  return (
    <Primitive.Input
      className="h-9 w-full border-b border-border bg-transparent px-2 outline-none"
      {...props}
    />
  )
}
/** 提供可滚动的候选列表。 */
export function CommandList(props: ComponentProps<typeof Primitive.List>) {
  return <Primitive.List className="max-h-64 overflow-y-auto" {...props} />
}
/** 渲染可通过方向键和回车选择的结果。 */
export function CommandItem({ className, ...props }: ComponentProps<typeof Primitive.Item>) {
  return (
    <Primitive.Item
      className={cn("cursor-pointer rounded p-2 data-[selected=true]:bg-raise-3", className)}
      {...props}
    />
  )
}
