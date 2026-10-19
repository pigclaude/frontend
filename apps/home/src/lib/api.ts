// 负责创建 home 使用的带 cookie HTTP client 和 Rust API facade。
import { createClient } from "@pigclaude/api/client"
import { createHomeApi } from "@pigclaude/api/home"
import { requestHomeSessionRevalidation } from "@/lib/auth-query"

const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? ""

/** home 浏览器 client，始终携带 session cookie。 */
export const homeClient = createClient({
  baseUrl,
  credentials: "include",
  onUnauthorized: () => {
    requestHomeSessionRevalidation()
  },
})

const api = createHomeApi(homeClient)

/** home 页面唯一 API facade；退出复用既有 cookie client 与 Rust 端点。 */
export const homeApi = {
  ...api,
  auth: {
    ...api.auth,
    /** 撤销当前服务器会话，并接受既有端点的无内容成功响应。 */
    logout: () => homeClient.post<void>("/v1/auth/logout"),
  },
}
