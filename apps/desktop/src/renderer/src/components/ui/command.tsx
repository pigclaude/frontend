// 负责桌面端的 shadcn Command 组件：由 cmdk 提供搜索、方向键导航与可访问选项语义。

import type { ComponentProps } from "react"
import { Command as Primitive } from "cmdk"
import { cn } from "../../lib/cn"
import { Icon } from "../icon"

/** 渲染可过滤并循环使用方向键导航的命令容器。 */
export function Command({ className, ...props }: ComponentProps<typeof Primitive>) {
  return <Primitive className={cn("ui-command", className)} {...props} />
}

/** 渲染搜索输入框，搜索图标不参与可访问名称。 */
export function CommandInput({ className, ...props }: ComponentProps<typeof Primitive.Input>) {
  return (
    <div className="command-input-wrap">
      <Icon name="search" small />
      <Primitive.Input className={cn("command-input", className)} {...props} />
    </div>
  )
}

/** 渲染可滚动的搜索候选列表。 */
export function CommandList({ className, ...props }: ComponentProps<typeof Primitive.List>) {
  return <Primitive.List className={cn("command-list", className)} {...props} />
}

/** 搜索没有匹配选项时显示提示。 */
export function CommandEmpty({ className, ...props }: ComponentProps<typeof Primitive.Empty>) {
  return <Primitive.Empty className={cn("command-empty", className)} {...props} />
}

/** 渲染支持附加搜索关键词及键盘选择的命令选项。 */
export function CommandItem({ className, ...props }: ComponentProps<typeof Primitive.Item>) {
  return <Primitive.Item className={cn("menu-item command-item", className)} {...props} />
}
