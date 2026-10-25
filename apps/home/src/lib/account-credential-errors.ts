// 负责把改邮箱、改密码接口的错误转成固定中文提示，不回显服务端原文。
import { ApiError } from "@pigclaude/api/client"
import { captchaErrorMessage } from "@pigclaude/web-ui/lib/captcha-errors"

/** 错误发生在哪一步；同一个 403 在核验之后表示核验失效，其余场景表示会话变化。 */
export type CredentialStep = "send_email_code" | "send_password_code" | "change_email" | "password"

/** 返回读得懂的提示；未知错误统一为「操作失败，请稍后重试」。 */
export function accountCredentialError(cause: unknown, step: CredentialStep): string {
  const captcha = captchaErrorMessage(cause)
  if (captcha) return captcha
  if (!(cause instanceof ApiError)) return "操作失败，请稍后重试"
  switch (cause.code) {
    case "EMAIL_CODE_INVALID":
      return "验证码错误或已失效"
    case "EMAIL_CODE_RATE_LIMITED":
      return "发送太频繁，请稍后重试"
    case "MAIL_UNAVAILABLE":
      return "邮件服务暂未开放"
    case "MAIL_SEND_FAILED":
      return "邮件发送失败，请稍后重试"
    case "INVALID_INPUT":
      if (step === "send_email_code") return "请输入一个和当前邮箱不同的有效邮箱"
      if (step === "password") return "新密码需要 8～1024 个字符"
      return "请求无效，请刷新后重试"
  }
  if (cause.status === 403)
    return step === "send_email_code" || step === "change_email"
      ? "身份核验已过期，请重新核验"
      : "登录状态已变化，请刷新页面后重试"
  if (cause.status === 401) return "登录已失效，请重新登录"
  return "操作失败，请稍后重试"
}

/** 429 时服务端给出的剩余秒数；没有时返回 null。 */
export function retryAfterSeconds(cause: unknown): number | null {
  if (!(cause instanceof ApiError) || cause.status !== 429) return null
  const seconds = Number(cause.metadata.retryAfterSeconds)
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : null
}
