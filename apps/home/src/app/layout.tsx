// 负责 home 根布局、品牌元数据和 React Query provider。
import type { Metadata } from "next"
import type { ReactNode } from "react"
import "./globals.css"
import { themeInitializationScript } from "@pigclaude/web-ui/lib/theme"
import { Providers } from "@/components/providers"

/** 提供公开站点品牌标题和账户入口说明。 */
export const metadata: Metadata = {
  title: "PigClaude",
  description: "PigClaude account and membership",
}

/** 包装所有 home 路由，提供统一样式和查询缓存。 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitializationScript }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
