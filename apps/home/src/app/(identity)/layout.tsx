// 负责中央身份页面的公共外壳，不读取用户站 RP 会话。
import type { Metadata } from "next"
import { Suspense, type ReactNode } from "react"
import { Nav } from "@/components/nav"
import { IdentityNav } from "@/components/identity/identity-nav"
/** 中央交互地址不进入 Referer 或搜索索引。 */
export const metadata: Metadata = {
  referrer: "no-referrer",
  robots: { index: false, follow: false },
}
/** 复用认证页面布局，支持没有网站 Cookie 的原生授权浏览器；顶栏标记只看地址中的 realm。 */
export default function IdentityLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <Suspense fallback={<Nav variant="auth" />}>
        <IdentityNav />
      </Suspense>
      <main className="auth-glow relative flex flex-1 items-center justify-center px-[var(--container-gutter-desktop)] py-[var(--space-8)]">
        {children}
      </main>
    </div>
  )
}
