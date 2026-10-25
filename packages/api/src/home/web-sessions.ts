// 负责本人网页登录会话列表与退出，所有写入先读取当前 RP CSRF。
import { createCsrfWriter } from "./account-credentials"
import type { HttpClient } from "../client"
import type { WebSessionView } from "@pigclaude/contracts/user-web-sessions"

/** 创建网页登录 facade；写入绑定当前会话代次与界面 owner。 */
export function createWebSessionsApi(client: HttpClient) {
  const write = createCsrfWriter(client)
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
