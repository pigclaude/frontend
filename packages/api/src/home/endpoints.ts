// 负责封装 Home 会员和账户查询；登录身份只经中央 OIDC 交互确认。
import { createHomeMembershipApi } from "../membership/home"
import type { HttpClient } from "../client"
import type { CaptchaConfig } from "@pigclaude/contracts/captcha"
import type * as T from "./types"

/** 创建 home API，所有请求复用共享 cookie client。 */
export function createHomeApi(c: HttpClient) {
  return {
    auth: {
      /** 读取公开验证码配置，保留共享 cookie 和错误处理边界。 */
      captcha: () => c.get<CaptchaConfig>("/v1/auth/captcha"),
    },
    user: { me: () => c.get<T.MeResponse>("/v1/user/me") },
    membership: createHomeMembershipApi(c),
  }
}

/** home API 的结构类型。 */
export type HomeApi = ReturnType<typeof createHomeApi>
