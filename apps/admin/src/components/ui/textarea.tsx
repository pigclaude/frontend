// 负责迁入 Pigcursor 成熟后台的textarea组件与交互，保持原有布局和语义。
import * as React from "react"
import { cn } from "@pigclaude/web-ui/lib/utils"
import { fieldClass } from "./input"

/** Textarea 保持后台组件的样式、可访问语义和交互契约。 */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        fieldClass,
        "flex field-sizing-content min-h-20 px-2.5 py-2 leading-relaxed",
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }
