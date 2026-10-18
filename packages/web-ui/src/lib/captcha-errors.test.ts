// 负责验证验证码文案只识别结构化验证码错误，并兼容既有 reason 格式。
import { describe, expect, it } from "vitest"
import { captchaErrorMessage } from "./captcha-errors"

describe("captcha error messages", () => {
  it.each([
    [{ code: "CAPTCHA_REQUIRED" }, "请先完成验证码验证"],
    [{ code: "CAPTCHA_INVALID" }, "验证码无效或已过期，请重新验证"],
    [{ code: "CAPTCHA_UNAVAILABLE" }, "验证码服务暂时不可用，请稍后重试"],
    [{ code: undefined, reason: "CAPTCHA_INVALID" }, "验证码无效或已过期，请重新验证"],
    [{ code: 400, reason: "CAPTCHA_REQUIRED" }, "请先完成验证码验证"],
    [{ code: "INVALID_CREDENTIALS", reason: "凭据错误", status: 401 }, null],
    [{ code: 401, reason: "expired" }, null],
    [new Error("offline"), null],
    [null, null],
  ])("maps only the captcha boundary %#", (error, expected) => {
    expect(captchaErrorMessage(error)).toBe(expected)
  })
})
