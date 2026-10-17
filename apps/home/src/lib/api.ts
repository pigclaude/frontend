// 负责创建 home 使用的带 cookie HTTP client 和 Rust API facade。
import { createClient, createHomeApi } from "@pigclaude/api"
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

/** home 页面唯一可用的 API facade，页面不直接调用 fetch。 */
export const homeApi = createHomeApi(homeClient)
