// 负责设置页面的通用外框、标题、分组和行布局。
import type { ReactNode } from "react"
import { ScrollPanel } from "../../components/shell"

/** 设置页容器：顶栏拖动区加可滚动的居中内容列。 */
export function SettingPage({
  title,
  sub,
  actions,
  children,
}: {
  title: string
  sub?: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <ScrollPanel>
      <div className="page narrow settings-page">
        <header className="page-head">
          <div>
            <h1>{title}</h1>
            {sub ? <p className="sub">{sub}</p> : null}
          </div>
          {actions ? <div className="actions">{actions}</div> : null}
        </header>
        {children}
      </div>
    </ScrollPanel>
  )
}

/** 设置页分组；不给标题时作为页面的第一组直接显示。 */
export function SettingSection({
  title,
  end,
  children,
}: {
  title?: string
  end?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="section">
      {title ? (
        <div className="section-head">
          <h2>{title}</h2>
          {end ? <div className="end">{end}</div> : null}
        </div>
      ) : null}
      <div className="group">{children}</div>
    </section>
  )
}

/** 设置页单行：左侧标题和说明，右侧是控件或只读值。 */
export function SettingRow({
  title,
  description,
  mono,
  value,
  children,
}: {
  title: ReactNode
  description?: ReactNode
  mono?: boolean
  value?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="item">
      <div className="main">
        <div className="ttl">{title}</div>
        {description ? <div className={mono ? "desc mono" : "desc"}>{description}</div> : null}
      </div>
      {children ? <div className="trail">{children}</div> : <span className="val">{value}</span>}
    </div>
  )
}
