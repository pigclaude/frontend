// 负责提供后台表格统一卡片容器、工具栏和空态插槽。
import type { ReactNode } from "react"

interface TableCardProps {
  title: string
  description?: string
  toolbar?: ReactNode
  children: ReactNode
  footer?: ReactNode
}

/** 组织标题、筛选控件、服务端列表和分页器。 */
export function TableCard({ title, description, toolbar, children, footer }: TableCardProps) {
  return (
    <section className="admin-card">
      <div className="admin-card-header">
        <div>
          <h2 style={{ margin: 0, fontSize: 17 }}>{title}</h2>
          {description ? <p className="admin-muted">{description}</p> : null}
        </div>
        {toolbar ? <div className="admin-form-row">{toolbar}</div> : null}
      </div>
      <div className="admin-table-wrap">{children}</div>
      {footer ? <div className="admin-card-body">{footer}</div> : null}
    </section>
  )
}
