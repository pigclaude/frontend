// 负责开关。底层是 shadcn 用的 Radix Switch，滑块样式来自设计稿。
import * as SwitchPrimitive from "@radix-ui/react-switch"
import type { ComponentProps } from "react"
import { cn } from "../../lib/cn"

/** 渲染可切换的开关，选中时滑块靠右。 */
export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return <SwitchPrimitive.Root className={cn("switch", className)} {...props} />
}
