// 负责渲染 PigClaude 登录和注册入口。
"use client"

import { Suspense } from "react"
import { Nav } from "@/components/nav"
import { AuthPanel } from "@/components/auth/auth-panel"

/** 提供登录页面的 Suspense 边界，支持 tab 查询参数。 */
export default function LoginPage() {
  return (
    <>
      <Nav />
      <main className="page-shell narrow">
        <Suspense fallback={<p role="status">加载中…</p>}>
          <AuthPanel />
        </Suspense>
      </main>
    </>
  )
}
