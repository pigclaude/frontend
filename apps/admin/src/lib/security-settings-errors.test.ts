// 负责以真实 ApiError 验证安全设置文案，不泄漏服务端错误详情且未知码不能命中对象原型。
import { ApiError } from "@pigclaude/api/client"
import { expect, it } from "vitest"
import { securitySettingsErrorMessage } from "./security-settings-errors"
it.each([
  ["CAPTCHA_REQUIRED", 400, "请先完成草稿验证码验证"],
  ["CAPTCHA_INVALID", 400, "草稿验证码无效或已过期，请重新验证"],
  ["UNAUTHORIZED", 401, "管理员登录已失效，请重新登录"],
  ["EXPIRED", 401, "管理员登录已失效，请重新登录"],
  ["UNSUPPORTED_MEDIA_TYPE", 415, "设置请求格式不正确，请刷新页面后重试"],
  ["UNKNOWN", 500, "安全设置操作失败，请稍后重试"],
  ["toString", 500, "安全设置操作失败，请稍后重试"],
  ["__proto__", 500, "安全设置操作失败，请稍后重试"],
])("maps real ApiError %s safely", (code, status, expected) => {
  expect(
    securitySettingsErrorMessage(
      new ApiError(status, { code, message: "SQL secret-sentinel", reason: "private-reason" }),
    ),
  ).toBe(expected)
})
it("uses generic guidance for non API errors", () => {
  expect(securitySettingsErrorMessage(new Error("SQL secret-sentinel"))).toBe(
    "安全设置操作失败，请稍后重试",
  )
})
