// 负责挂载管理后台 React 根节点、Query 缓存和统一 toast 容器。
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider } from "react-router"
import { Toaster } from "sonner"
import { router } from "@/app"
import { createAdminQueryClient } from "@/lib/query-client"
import "@/index.css"

const queryClient = createAdminQueryClient()

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
