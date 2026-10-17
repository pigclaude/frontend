// 负责提供管理后台页面统一的标题、描述和操作区。
import type { ReactNode } from "react"

interface PageHeadProps {
  title: string
  subtitle?: string
  actions?: ReactNode
}

/** 渲染页面标题栏，保证移动端操作区可以换行。 */
export function PageHead({ title, subtitle, actions }: PageHeadProps) {
  return (
    <div className="admin-card-header" style={{ marginBottom: 18, border: 0, padding: 0 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 24 }}>{title}</h1>
        {subtitle ? <p className="admin-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="admin-form-row">{actions}</div> : null}
    </div>
  )
}
