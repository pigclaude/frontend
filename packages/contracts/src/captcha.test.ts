// 负责验证公开验证码配置的完整组合，异常响应不能被解释为 disabled。
import { describe, expect, it } from "vitest"
import { isCaptchaConfig } from "./captcha"

describe("public captcha contract", () => {
  it.each([
    [{ enabled: false, provider: "turnstile", siteKey: null, mode: "disabled" }, true],
    [{ enabled: true, provider: "turnstile", siteKey: "key", mode: "testing" }, true],
    [{ enabled: true, provider: "turnstile", siteKey: "key", mode: "required" }, true],
    [{ enabled: true, provider: "turnstile", siteKey: null, mode: "required" }, false],
    [{ enabled: false, provider: "turnstile", siteKey: null, mode: "required" }, false],
    [{ enabled: true, provider: "turnstile", siteKey: "key", mode: "disabled" }, false],
    [{ enabled: false, provider: "turnstile", siteKey: "key", mode: "disabled" }, false],
    [{ enabled: true, provider: "turnstile", siteKey: " ", mode: "testing" }, false],
    [{ enabled: true, provider: "other", siteKey: "key", mode: "testing" }, false],
    [{ enabled: false, provider: "turnstile", mode: "disabled" }, false],
    [{ enabled: false }, false],
    [null, false],
  ])("accepts only a complete safe combination %#", (value, expected) => {
    expect(isCaptchaConfig(value)).toBe(expected)
  })
})
