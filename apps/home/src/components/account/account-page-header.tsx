// 负责个人中心各页面顶部的标题和一句说明。
import type { ReactNode } from "react"

/** 页面标题使用 h1，说明文字是一行灰字。 */
export function AccountPageHeader({ title, subtitle }: { title: string; subtitle: ReactNode }) {
  return (
    <header className="account-page-head">
      <h1 className="page-title">{title}</h1>
      <p className="account-page-sub">{subtitle}</p>
    </header>
  )
}
