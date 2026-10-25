// 负责封装 Home 会员、账户查询与已登录账号凭据写入；登录身份只经中央 OIDC 交互确认。
import { createHomeMembershipApi } from "../membership/home"
import type { HttpClient } from "../client"
import type { CaptchaConfig } from "@pigclaude/contracts/captcha"
import { createAccountCredentialApi, createCsrfWriter } from "./account-credentials"
import { createWebSessionsApi } from "./web-sessions"
import type * as T from "./types"

/** 创建 home API，所有请求复用共享 cookie client。 */
export function createHomeApi(c: HttpClient) {
  const withCsrf = createCsrfWriter(c)
  return {
    auth: {
      /** 读取公开验证码配置，保留共享 cookie 和错误处理边界。 */
      captcha: () => c.get<CaptchaConfig>("/v1/auth/captcha"),
      /** 读取公开邮件可用性；注册入口据此决定是否开放邮箱注册。 */
      mailStatus: () => c.get<{ available: boolean }>("/v1/auth/mail-status"),
    },
    user: {
      me: () => c.get<T.MeResponse>("/v1/user/me"),
      /** 修改昵称并返回更新后的当前用户资料。 */
      updateProfile: (input: { nickname: string }, isCurrent: () => boolean = () => true) =>
        withCsrf(
          (csrf) => c.patch<T.MeResponse>("/v1/user/profile", { ...input, csrf }),
          isCurrent,
        ),
    },
    account: createAccountCredentialApi(c),
    /** 本人网页登录会话列表与退出。 */
    webSessions: createWebSessionsApi(c),
    membership: createHomeMembershipApi(c),
  }
}

/** home API 的结构类型。 */
export type HomeApi = ReturnType<typeof createHomeApi>
