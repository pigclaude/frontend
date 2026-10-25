// 负责个人中心三个页面共用的分组列表：小号灰字标题、描边容器、图标块加标题说明加右侧操作。
import type { ReactNode } from "react"
import { useId } from "react"
import { cn } from "@pigclaude/web-ui/lib/utils"

/** 一个带标题的分组；`action` 放在标题右侧，例如「退出其他所有网页」。 */
export function SetGroup({
  title,
  action,
  children,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
}) {
  const id = useId()
  return (
    <section className="set-group" aria-labelledby={id}>
      <div className="set-group-head">
        <h2 id={id} className="set-group-title">
          {title}
        </h2>
        {action}
      </div>
      <div className="set-list">{children}</div>
    </section>
  )
}

/** 分组里的一行：左侧图标块，中间标题（可带标签）和一行灰色说明，右侧操作。 */
export function SetRow({
  icon,
  title,
  badge,
  description,
  trailing,
}: {
  icon: ReactNode
  title: ReactNode
  badge?: ReactNode
  description?: ReactNode
  trailing?: ReactNode
}) {
  return (
    <div className="set-row">
      <span className="set-row-icon" aria-hidden="true">
        {icon}
      </span>
      <div className="set-row-body">
        <div className="set-row-title">
          {title}
          {badge}
        </div>
        {description && <div className="set-row-desc">{description}</div>}
      </div>
      {trailing && <div className="set-row-trailing">{trailing}</div>}
    </div>
  )
}

/** 行标题旁的小标签：绿色表示已验证或已绑定，紫色表示当前，灰色表示未绑定等中性状态。 */
export function SetTag({
  tone,
  children,
}: {
  tone: "success" | "accent" | "muted"
  children: ReactNode
}) {
  return <span className={cn("set-tag", `set-tag-${tone}`)}>{children}</span>
}
