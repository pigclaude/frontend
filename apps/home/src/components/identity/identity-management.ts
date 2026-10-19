// 负责登录方式管理的固定中文反馈与共享当前会话 facade。
import { ApiError } from "@pigclaude/api/client"
import { createIdentityApi } from "@pigclaude/api/home/identity"
import { captchaErrorMessage } from "@pigclaude/web-ui/lib/captcha-errors"
import { homeClient } from "@/lib/api"
/** 登录方式只走 Home 固定同源 Cookie client。 */
export const identityManagement = createIdentityApi(homeClient)
/** 已验证服务器接续使用顶层导航，绝不重组 code/state。 */
export const identityManagementNavigation = { assign: (url: string) => window.location.assign(url) }
/** 只翻译已知安全错误；不把 query 当作近期核验证明。 */
export function identityManagementError(error: unknown): string {
  const captcha = captchaErrorMessage(error)
  if (captcha) return captcha
  const code =
    error instanceof ApiError ? String(error.code) : typeof error === "string" ? error : ""
  const messages: Record<string, string> = {
    IDENTITY_CONFLICT: "此登录方式已绑定其他账号，请使用其他登录方式",
    identity_conflict: "此登录方式已绑定其他账号，请使用其他登录方式",
    RECENT_AUTHENTICATION_REQUIRED: "需要近期身份核验，请重新核验后重试",
    access_denied: "操作未获授权，请重新核验后重试；不能移除最后一个可用凭据",
    IDENTITY_UNAVAILABLE: "登录方式状态已变化，请刷新列表后重试",
    ACCOUNT_BANNED: "账号已被封禁，无法继续操作",
    FEDERATION_UNAVAILABLE: "供应商暂时不可用，请稍后重试或使用其他已绑定凭据",
    FEDERATION_DISABLED: "此登录方式尚未开放，请使用其他已绑定凭据",
    FEDERATION_RATE_LIMITED: "操作过于频繁，请稍后重试",
    FEDERATION_REJECTED: "供应商核验未完成，请重新尝试",
    invalid_credentials: "当前密码不正确，请重试",
    invalid_request: "请求已失效，请刷新后重试",
  }
  return Object.hasOwn(messages, code) ? messages[code] : "操作失败，请稍后重试"
}
/** 固定供应商显示名，不使用任意 query 生成按钮或请求路径。 */
export const identityProviderNames = { google: "Google", github: "GitHub" }
