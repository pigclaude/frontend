// 负责为 home 页面提供共享的 React Query client。
"use client"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useState, type ReactNode } from "react"

/** 为 home 树提供稳定的查询缓存和错误恢复能力。 */
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: false },
        },
      }),
  )
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}
