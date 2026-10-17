// 负责提供直达注册页，并复用统一认证面板。
"use client"

import { Suspense } from "react"
import { Nav } from "@/components/nav"
import { AuthPanel } from "@/components/auth/auth-panel"

/** 渲染注册页，默认显示注册标签。 */
export default function RegisterPage() {
  return (
    <>
      <Nav />
      <main className="page-shell narrow">
        <Suspense fallback={<p role="status">加载中…</p>}>
          <AuthPanel initialMode="register" />
        </Suspense>
      </main>
    </>
  )
}
