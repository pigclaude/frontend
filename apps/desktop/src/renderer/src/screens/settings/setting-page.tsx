// 负责设置页面的通用标题、分组和行布局。
import type { ReactNode } from "react"

/** 设置页容器。 */
export function SettingPage({
  title,
  sub,
  children,
}: {
  title: string
  sub?: string
  children: ReactNode
}) {
  return (
    <div className="page narrow">
      <header className="page-head">
        <div>
          <h1>{title}</h1>
          {sub ? <p className="sub">{sub}</p> : null}
        </div>
      </header>
      {children}
    </div>
  )
}

/** 设置页分组。 */
export function SettingSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="section">
      <div className="section-head">
        <h2>{title}</h2>
      </div>
      <div className="group">{children}</div>
    </section>
  )
}

/** 设置页单行。 */
export function SettingRow({
  title,
  description,
  value,
  children,
}: {
  title: string
  description?: string
  value?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="item">
      <div className="main">
        <div className="ttl">{title}</div>
        {description ? <div className="desc">{description}</div> : null}
      </div>
      {children ?? <span className="val">{value}</span>}
    </div>
  )
}
