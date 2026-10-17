// 负责渲染 PigClaude 第一阶段公开首页和登录入口。
import Link from "next/link"
import { Nav } from "@/components/nav"

/** 展示品牌说明并提供有限的账号与会员入口。 */
export default function HomePage() {
  return (
    <>
      <Nav />
      <main className="page-shell">
        <p className="muted">PigClaude workspace</p>
        <h1 className="page-title">让 Claude 工作流保持清晰、可靠。</h1>
        <p className="muted">登录账号、查看会员权益，并为桌面客户端确认设备授权。</p>
        <div className="button-row" style={{ marginTop: 24 }}>
          <Link className="button" href="/login">
            登录 / 注册
          </Link>
          <Link className="button button-secondary" href="/membership">
            查看会员
          </Link>
        </div>
      </main>
    </>
  )
}
