// 负责 home 根布局、品牌元数据和 React Query provider。
import type { Metadata } from "next"
import type { ReactNode } from "react"
import "./globals.css"
import { Providers } from "@/components/providers"

export const metadata: Metadata = {
  title: "PigClaude",
  description: "PigClaude account and membership",
}

/** 包装所有 home 路由，提供统一样式和查询缓存。 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
