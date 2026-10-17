// 负责读取当前管理员身份，供 guard 和顶部会话信息共享同一个 Query 缓存。
import { useQuery } from "@tanstack/react-query"
import { adminApi } from "@/lib/api"

/** 读取管理员摘要，401/403 等错误交给路由 guard 处理。 */
export function useAdminMe() {
  return useQuery({
    queryKey: ["admin-me"],
    queryFn: adminApi.me,
    staleTime: 30_000,
    retry: false,
  })
}
