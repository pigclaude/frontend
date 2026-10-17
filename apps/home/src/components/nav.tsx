// 负责渲染 PigClaude home 的受限第一阶段主导航。
import Link from "next/link"

/** 渲染只包含登录、会员和授权入口的主导航。 */
export function Nav() {
  return (
    <header className="site-header">
      <Link className="brand" href="/">
        PigClaude
      </Link>
      <nav aria-label="主导航" className="nav-links">
        <Link href="/dashboard">账户</Link>
        <Link href="/membership">会员</Link>
        <Link href="/login">登录 / 注册</Link>
      </nav>
    </header>
  )
}
