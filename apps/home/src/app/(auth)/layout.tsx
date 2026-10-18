// 负责迁入 Pigcursor 登录和注册共同使用的居中外壳及底部光晕。
import type { ReactNode } from "react"
import { Nav } from "@/components/nav"

/** 让登录和注册页共享与原站一致的顶栏、宽度和垂直居中布局。 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <Nav variant="auth" />
      <main className="auth-glow relative flex flex-1 items-center justify-center overflow-hidden px-[var(--container-gutter-desktop)] py-[var(--space-8)]">
        {children}
      </main>
    </div>
  )
}
