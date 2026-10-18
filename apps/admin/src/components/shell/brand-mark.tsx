// 负责迁入 Pigcursor 成熟后台的brand-mark组件与交互，保持原有布局和语义。
import { PigclaudeMark } from "@pigclaude/web-ui/components/pigclaude-mark"
import { cn } from "@pigclaude/web-ui/lib/utils"

/** 使用共享品牌标记，保留原后台墨色底与反白图形。 */
/** BrandMark 保持后台组件的样式、可访问语义和交互契约。 */
export function BrandMark({
  className,
  markClassName,
}: {
  className?: string
  markClassName?: string
}) {
  return (
    <span
      className={cn(
        "relative flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-[#0B0B0F] text-white shadow-sm",
        className,
      )}
    >
      <PigclaudeMark className={cn("size-full", markClassName)} tone="inverse" framed />
    </span>
  )
}
