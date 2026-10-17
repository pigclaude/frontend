// 负责挂载管理后台 React 根节点、Query 缓存和统一 toast 容器。
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider } from "react-router"
import { Toaster } from "sonner"
import { ApiError } from "@pigclaude/api"
import { router } from "@/app"
import "@/index.css"

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => {
      if (
        error instanceof ApiError &&
        error.status === 401 &&
        typeof window !== "undefined" &&
        window.location.pathname !== "/login"
      ) {
        window.location.replace("/login")
      }
    },
  }),
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
})

const root = document.getElementById("root")
if (root) {
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
        <Toaster />
      </QueryClientProvider>
    </StrictMode>,
  )
}
