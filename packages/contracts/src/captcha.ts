// 负责定义公开验证码配置和认证 action，不包含服务端 Secret 或部署设置。

/** 服务明确关闭验证码时才允许不提交 token。 */
export type CaptchaConfig =
  | { enabled: false; provider: "turnstile"; siteKey: null; mode: "disabled" }
  | { enabled: true; provider: "turnstile"; siteKey: string; mode: "testing" | "required" }

/** 三个认证入口使用独立 action，服务端根据路由核验。 */
export type CaptchaAction = "home_login" | "home_register" | "admin_login"

/** 验证公开配置的组合完整性，异常响应不能退化为关闭验证码。 */
export function isCaptchaConfig(value: unknown): value is CaptchaConfig {
  if (typeof value !== "object" || value === null || !("provider" in value)) return false
  if (value.provider !== "turnstile" || !("mode" in value) || !("enabled" in value)) return false
  if (!("siteKey" in value)) return false
  if (value.mode === "disabled") return value.enabled === false && value.siteKey === null
  return (
    (value.mode === "testing" || value.mode === "required") &&
    value.enabled === true &&
    typeof value.siteKey === "string" &&
    value.siteKey.trim().length > 0
  )
}
