// 负责开关。底层使用 Base UI Switch，滑块样式来自 Pigcode token。
import { Switch as BaseSwitch } from "@base-ui/react/switch"
import type { ComponentProps } from "react"
import { cn } from "../../lib/cn"

/** 渲染可切换的开关，选中时滑块靠右。 */
export function Switch({ className, ...props }: ComponentProps<typeof BaseSwitch.Root>) {
  return (
    <BaseSwitch.Root className={cn("switch", className)} {...props}>
      <BaseSwitch.Thumb className="switch-thumb" />
    </BaseSwitch.Root>
  )
}
