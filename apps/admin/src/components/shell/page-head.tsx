// 负责迁入 Pigcursor 成熟后台的page-head组件与交互，保持原有布局和语义。
import type { ReactNode } from "react"

interface PageHeadProps {
  title: string
  subtitle?: string
  actions?: ReactNode
}

/** 列表/详情页通用页头：标题 22px/600 + 说明文案 + 右侧操作区。 */
/** PageHead 保持后台组件的样式、可访问语义和交互契约。 */
export function PageHead({ title, subtitle, actions }: PageHeadProps) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0">
        <h1 className="text-[22px] leading-tight font-semibold tracking-[-0.02em] text-foreground">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
