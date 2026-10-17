// 负责创建管理后台唯一的 HTTP client 和第一阶段 Admin API facade。
import { createAdminApi, createClient } from "@pigclaude/api"
import { redirectToLogin } from "@/lib/navigation"

/** 管理后台 client，默认使用同源 loopback Rust API 并保留管理员 cookie。 */
export const adminClient = createClient({
  baseUrl: import.meta.env.VITE_API_BASE ?? "",
  credentials: "include",
  onUnauthorized: redirectToLogin,
})

/** 所有后台查询和 mutation 都经由这一组第一阶段 endpoint。 */
export const adminApi = createAdminApi(adminClient)
