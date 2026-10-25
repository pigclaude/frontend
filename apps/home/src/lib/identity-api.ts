// 负责中央身份交互的脱敏 DTO、固定同源 API 和安全中文错误。
import { ApiError, createClient } from "@pigclaude/api/client"
import { captchaErrorMessage } from "@pigclaude/web-ui/lib/captcha-errors"
import type { CaptchaConfig } from "@pigclaude/contracts/captcha"

/** 服务器核验的交互视图，身份行为仅由此视图决定。 */
export interface IdentityInteraction {
  interactionId: string
  realm: "User" | "Admin"
  clientId: string
  scopes: string[]
  phase: "login" | "consent" | "device_approval"
  csrf: string
  expiresAt: number
  registrationAllowed: boolean
  providers: ("google" | "github")[]
  account: { email: string } | null
  device: null | {
    deviceId: string
    platform: string
    name: string
    status: "new" | "active" | "revoked"
    bindingEpoch: string | null
  }
  /** 过期后重新发起登录的网站入口；桌面端交互为 null，只能回到客户端发起。 */
  restartUrl: string | null
}

/** 认证与审批只接续服务器给出的视图或一次性跳转。 */
export type IdentityContinuation =
  | { type: "redirect"; redirect: string }
  | {
      type: "require_login" | "require_consent" | "require_device_approval"
      interaction: IdentityInteraction
    }

/** 中央表单只提交密码凭据和验证码，不携带自报身份。 */
export interface IdentityPassword {
  mode: "login" | "register"
  email: string
  password: string
  captchaToken?: string
  /** 注册时与服务端验证码绑定的一次性邮箱验证码。 */
  emailCode?: string
}

/** 发码请求；响应不区分邮箱是否已经注册。 */
export interface IdentityEmailCodeInput {
  purpose: "register" | "reset_password"
  email: string
  captchaToken?: string
}

/** 发码成功响应；倒计时应以服务端给出的秒数为准。 */
export interface IdentityEmailCodeSent {
  type: "sent"
  resendAfterSeconds: number
}

/** 重设密码成功响应；只确认事务完成，不创建网站会话。 */
export interface IdentityPasswordResetDone {
  type: "password_reset"
}

/** 重设密码提交：验证码与最终密码一次提交，账号错误与错码同形。 */
export interface IdentityPasswordResetInput {
  email: string
  emailCode: string
  newPassword: string
}

const client = createClient({ fetch: (...args) => fetch(...args) })
const path = (view: IdentityInteraction) =>
  `/v1/identity/interactions/${encodeURIComponent(view.interactionId)}`
const proof = (view: IdentityInteraction) => ({ realm: view.realm, csrf: view.csrf })

/** 只使用服务器一次性接续，不构造 callback，不记录导航值。 */
export const identityNavigation = { assign: (url: string) => window.location.assign(url) }

/** 中央交互不触发 Home me 恢复，也不使用可配置的跨源 API base。 */
export const identityApi = {
  /** 从原浏览器绑定恢复交互；realm 只作为服务端查找选择器。 */
  load: (id: string, realm: "User" | "Admin") =>
    client.get<IdentityInteraction>(`/v1/identity/interactions/${encodeURIComponent(id)}`, {
      realm,
    }),
  /** 保留当前密码路径的验证码策略。 */
  captcha: () => client.get<CaptchaConfig>("/v1/auth/captcha"),
  /** 管理员验证码策略同样来自公开配置。 */
  adminCaptcha: () => client.get<CaptchaConfig>("/admin/v1/auth/captcha"),
  /** 密码认证只验证 OP 身份，不创建网站会话。 */
  password: (view: IdentityInteraction, values: IdentityPassword) =>
    client.post<IdentityContinuation>(`${path(view)}/password`, { ...proof(view), ...values }),
  /** 读取公开邮件可用性；注册模式据此决定是否开放邮箱注册。 */
  mailStatus: () => client.get<{ available: boolean }>("/v1/auth/mail-status"),
  /** 在交互内请求邮箱验证码，响应固定为已发送。 */
  emailCode: (view: IdentityInteraction, input: IdentityEmailCodeInput) =>
    client.post<IdentityEmailCodeSent>(`${path(view)}/email-code`, {
      ...proof(view),
      ...input,
    }),
  /** 用已验证邮箱一次性重设密码；成功不推进交互也不创建会话。 */
  resetPassword: (view: IdentityInteraction, input: IdentityPasswordResetInput) =>
    client.post<IdentityPasswordResetDone>(`${path(view)}/password-reset`, {
      ...proof(view),
      ...input,
    }),
  /** 社交启动独立于密码验证码。 */
  provider: (view: IdentityInteraction, provider: "google" | "github") =>
    client.post<IdentityContinuation>(`${path(view)}/providers/${provider}/start`, proof(view)),
  /** 网站同意和拒绝均显式提交交互 CSRF。 */
  decide: (view: IdentityInteraction, action: "consent" | "deny") =>
    client.post<IdentityContinuation>(`${path(view)}/${action}`, proof(view)),
  /** 放弃当前身份并回到登录表单；只提交 realm 与 csrf。 */
  switchAccount: (view: IdentityInteraction) =>
    client.post<IdentityContinuation>(`${path(view)}/switch-account`, proof(view)),
  /** 设备关系代次仅来自已核验服务器视图；撤销关系必须明确重新授权。 */
  approveDevice: (view: IdentityInteraction, reauthorize: boolean) =>
    client.post<IdentityContinuation>(`${path(view)}/approve-device`, {
      ...proof(view),
      expectedBindingEpoch: view.device?.bindingEpoch ?? null,
      reauthorize,
    }),
}

/** 取邮箱 @ 前的部分作为显示名；没有 @ 时返回原值。 */
export function accountDisplayName(email: string): string {
  const at = email.indexOf("@")
  return at > 0 ? email.slice(0, at) : email
}

/** 只翻译固定错误，不反射服务器或供应商原始信息。 */
export function identityErrorMessage(reason: unknown): string {
  const captcha = captchaErrorMessage(reason)
  if (captcha) return captcha
  if (reason instanceof ApiError) {
    const messages: Record<string, string> = {
      ACCOUNT_BANNED: "账号已被封禁，无法继续登录",
      ACCOUNT_LINK_REQUIRED: "请先登录已有账号，再绑定此登录方式",
      VERIFIED_EMAIL_REQUIRED: "请先在供应商账号中设置可用的已验证邮箱",
      FEDERATION_UNAVAILABLE: "此登录方式暂时不可用，可重试或使用邮箱密码",
      FEDERATION_RATE_LIMITED: "操作过于频繁，请稍后重试",
      FEDERATION_DISABLED: "此登录方式尚未开放，请使用其他方式",
      FEDERATION_REJECTED: "此登录方式未完成，请重试或使用邮箱密码",
      invalid_credentials: "邮箱或密码不正确",
      identity_conflict: "此邮箱已注册，请登录已有账号",
      binding_conflict: "设备状态已变化，请从客户端重新发起授权",
      invalid_request: "交互已失效或不可用，请重新发起登录",
      access_denied: "此次操作未获授权，请重新发起登录",
      membership_required: "这个账号还没有可用会员，开通会员后再授权，或切换到已有会员的账号",
      EMAIL_CODE_INVALID: "验证码错误或已失效，请重新获取",
      EMAIL_CODE_RATE_LIMITED: "发送太频繁，请稍后重试",
      MAIL_UNAVAILABLE: "邮件服务暂不可用，请稍后重试",
      MAIL_SEND_FAILED: "邮件发送失败，请稍后重试",
    }
    const code = String(reason.code)
    const message = Object.hasOwn(messages, code) ? messages[code] : undefined
    if (message) return message
    if (reason.status === 503) return "服务暂时不可用，请稍后重试或使用其他登录方式"
  }
  return "请求失败，请稍后重试"
}
