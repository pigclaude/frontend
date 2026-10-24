// 负责等级编辑器统一的分区卡片、标题和说明。
import type { ReactNode } from "react"
import { cn } from "@pigclaude/web-ui/lib/utils"

/** 统一各表单区块的边框、内边距和标题层级。 */
export function EditorSection({
  title,
  description,
  children,
  className,
}: {
  title: string
  description?: string
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn("rounded-xl border border-border bg-background p-5", className)}>
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {description && <p className="mt-1 text-xs leading-relaxed text-meta">{description}</p>}
      </div>
      {children}
    </section>
  )
}
