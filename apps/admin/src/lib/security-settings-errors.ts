// 负责将设置范围的稳定错误码转换为安全中文，不透传响应原文、数据库或秘密信息。
import { ApiError } from "@pigclaude/api/client"
const messages: Readonly<Record<string, string>> = {
  INVALID_INPUT:
    "设置输入不合法，请检查 Site Key、Secret Key 和允许主机名；管理设置不能使用测试 key",
  UNSUPPORTED_MEDIA_TYPE: "设置请求格式不正确，请刷新页面后重试",
  SETTINGS_REVISION_CONFLICT: "设置已被其他管理员修改，请保留当前输入，撤销修改后刷新配置再重试",
  FORBIDDEN: "没有管理设置的权限，或请求来源不受信任，请从管理后台重新登录后重试",
  UNAUTHORIZED: "管理员登录已失效，请重新登录",
  EXPIRED: "管理员登录已失效，请重新登录",
  SETTINGS_UNAVAILABLE: "安全设置暂时不可用，请稍后刷新，或联系管理员检查服务配置",
  CAPTCHA_REQUIRED: "请先完成草稿验证码验证",
  CAPTCHA_INVALID: "草稿验证码无效或已过期，请重新验证",
  CAPTCHA_UNAVAILABLE: "验证码服务暂时不可用，请稍后重新验证草稿",
}
/** 仅依据已知错误码或 HTTP 状态给出指引；未知错误使用固定文案。 */
export function securitySettingsErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const message =
      typeof error.code === "string" && Object.hasOwn(messages, error.code)
        ? messages[error.code]
        : undefined
    if (message) return message
    if (error.status === 401) return messages.UNAUTHORIZED
    if (error.status === 403) return messages.FORBIDDEN
    if (error.status === 503) return messages.SETTINGS_UNAVAILABLE
    if (error.status === 400) return messages.INVALID_INPUT
  }
  return "安全设置操作失败，请稍后重试"
}
