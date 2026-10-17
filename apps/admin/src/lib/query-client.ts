// 负责组装管理后台共享 QueryClient，并让 query 与 mutation 的 401 走同一回跳策略。
import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query"
import { ApiError } from "@pigclaude/api"
import { redirectToLogin } from "@/lib/navigation"

function handleAuthError(error: unknown): void {
  if (error instanceof ApiError && error.status === 401) redirectToLogin()
}

/** 创建带 query/mutation 401 recovery 的后台 QueryClient。 */
export function createAdminQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({ onError: handleAuthError }),
    mutationCache: new MutationCache({ onError: handleAuthError }),
    defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
  })
}
