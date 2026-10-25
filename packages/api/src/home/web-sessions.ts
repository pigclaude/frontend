// 负责本人网页登录会话列表与退出，所有写入先读取当前 RP CSRF。
import { StaleSessionResponse, type HttpClient } from "../client"
import type { WebSessionView } from "@pigclaude/contracts/user-web-sessions"
import type { WebSessionBootstrap } from "../web-oidc"

/** 创建网页登录 facade；写入绑定当前会话代次与界面 owner。 */
export function createWebSessionsApi(client: HttpClient) {
  async function write(request: (csrf: string) => Promise<void>, owner: () => boolean) {
    const sameSession = client.captureSession?.() ?? (() => true)
    if (!owner() || !sameSession()) throw new StaleSessionResponse()
    const session = await client.get<WebSessionBootstrap>("/v1/session")
    if (!owner() || !sameSession()) throw new StaleSessionResponse()
    if (typeof session.csrf !== "string" || !session.csrf) throw new Error("会话校验失败")
    await request(session.csrf)
  }
  return {
    /** 读取本人有效的用户站网页登录，当前浏览器由 isCurrent 标记。 */
    list: () => client.get<WebSessionView[]>("/v1/user/web-sessions"),
    /** 退出指定网页登录；当前会话由服务器拒绝。 */
    revoke: (id: string, isCurrent: () => boolean) =>
      write(
        (csrf) =>
          client.post<void>(`/v1/user/web-sessions/${encodeURIComponent(id)}/revoke`, { csrf }),
        isCurrent,
      ),
    /** 退出除当前浏览器以外的全部网页登录。 */
    revokeOthers: (isCurrent: () => boolean) =>
      write(
        (csrf) => client.post<void>("/v1/user/web-sessions/revoke-others", { csrf }),
        isCurrent,
      ),
  }
}
