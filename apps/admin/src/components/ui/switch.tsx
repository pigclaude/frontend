// 负责迁入固定 Pigcursor 管理后台专用开关实体，保持来源滑块和交互语义。
import * as React from "react"
import { Switch as SwitchPrimitive } from "radix-ui"
import { cn } from "@pigclaude/web-ui/lib/utils"

/** 开关保留管理后台尺寸、白色滑块和精确位移。 */
function Switch({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & { size?: "sm" | "default" }) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch inline-flex shrink-0 cursor-pointer items-center rounded-full p-[2px] transition-colors duration-200 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35 disabled:cursor-not-allowed disabled:opacity-45 data-[size=default]:h-[18px] data-[size=default]:w-8 data-[size=sm]:h-4 data-[size=sm]:w-7 data-[state=checked]:bg-primary data-[state=unchecked]:bg-[var(--switch-off)]",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block rounded-full bg-white shadow-[0_1px_2px_rgb(0_0_0/0.3)] ring-0 transition-transform duration-200 ease-[cubic-bezier(0.2,0,0,1)] group-data-[size=default]/switch:size-[14px] group-data-[size=sm]/switch:size-3 data-[state=unchecked]:translate-x-0 group-data-[size=default]/switch:data-[state=checked]:translate-x-[14px] group-data-[size=sm]/switch:data-[state=checked]:translate-x-3"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
