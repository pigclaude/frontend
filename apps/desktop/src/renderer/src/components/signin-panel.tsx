// 负责登录与恢复页面共用的状态区域，统一标题、说明、进度和操作的可访问布局。
import { useId, type ReactNode } from "react"
import { Icon } from "./icon"

/** 状态区域只呈现调用方已确认的信息，不决定登录或会员权限。 */
export function SigninPanel({
  icon,
  tone,
  busy,
  title,
  sub,
  children,
}: {
  icon: string
  tone?: "bad"
  busy?: boolean
  title: ReactNode
  sub: string
  children?: ReactNode
}) {
  const titleId = useId()
  return (
    <section className="signin" aria-labelledby={titleId} aria-busy={busy || undefined}>
      <header className="signin-heading" role={busy ? "status" : undefined}>
        <div className="signin-mark" data-tone={tone} aria-hidden="true">
          <Icon name={icon} className={busy ? "signin-spinner" : undefined} />
        </div>
        <h1 id={titleId}>{title}</h1>
        <p className="signin-sub">{sub}</p>
      </header>
      {children}
    </section>
  )
}
