// 负责只翻译验证码错误，保留凭据、会话和其他 API 错误原有处理语义。

/** 从结构化 API 错误中提取验证码中文反馈；非验证码错误返回 null。 */
export function captchaErrorMessage(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null
  const code =
    "code" in error && typeof error.code === "string"
      ? error.code
      : "reason" in error
        ? error.reason
        : null
  switch (code) {
    case "CAPTCHA_REQUIRED":
      return "请先完成验证码验证"
    case "CAPTCHA_INVALID":
      return "验证码无效或已过期，请重新验证"
    case "CAPTCHA_UNAVAILABLE":
      return "验证码服务暂时不可用，请稍后重试"
    default:
      return null
  }
}
