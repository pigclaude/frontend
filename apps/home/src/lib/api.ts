// 负责创建 Home 固定同源 Cookie client 和 RP 会话退出 facade。
import { homeSessionGeneration } from "./session-generation"
import { createClient, StaleSessionResponse } from "@pigclaude/api/client"
import { createHomeApi } from "@pigclaude/api/home"
import type { WebSessionBootstrap } from "@pigclaude/api/web-oidc"
import { requestHomeSessionRevalidation } from "@/lib/auth-query"

const baseUrl = ""

/** home 浏览器 client，始终携带 session cookie。 */
export const homeClient = createClient({
  baseUrl,
  credentials: "include",
  generation: homeSessionGeneration.current,
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
    /** 先读取真实 RP bootstrap，再用该会话 CSRF 明确退出。 */
    logout: async (isCurrent: () => boolean = () => true) => {
      const sameSession = homeClient.captureSession?.() ?? (() => true)
      if (!isCurrent() || !sameSession()) throw new StaleSessionResponse()
      const session = await homeClient.get<WebSessionBootstrap>("/v1/session")
      if (!isCurrent() || !sameSession()) throw new StaleSessionResponse()
      await homeClient.post<void>("/v1/web/oidc/logout", { csrf: session.csrf })
    },
  },
}
