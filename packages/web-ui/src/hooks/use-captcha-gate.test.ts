// 负责提供本文件的前端契约、组件或样式实现。
import { describe, expect, it, vi } from "vitest"
import {
  captchaGateReducer,
  initialCaptchaGateState,
  isCaptchaGateReady,
  runCaptchaAttempt,
} from "./use-captcha-gate"

describe("captchaGateReducer", () => {
  it("验证码关闭时清空旧 token 并放开提交", () => {
    const state = captchaGateReducer(
      { token: "old-token", disabled: false, nonce: 3 },
      { type: "disabled" },
    )
    expect(state).toEqual({ token: "", disabled: true, nonce: 3 })
    expect(isCaptchaGateReady(state)).toBe(true)
  })

  it("reset 会退出 disabled 并递增 nonce，确保运行时重新开启后真正重挂出题", () => {
    const state = captchaGateReducer({ token: "", disabled: true, nonce: 3 }, { type: "reset" })
    expect(state).toEqual({ token: "", disabled: false, nonce: 4 })
    expect(isCaptchaGateReady(state)).toBe(false)
  })

  it("验证通过保存 token；失效只清 token、不误改开关态", () => {
    const verified = captchaGateReducer(initialCaptchaGateState, {
      type: "verified",
      token: "one-time-token",
    })
    expect(verified).toEqual({ token: "one-time-token", disabled: false, nonce: 0 })
    expect(isCaptchaGateReady(verified)).toBe(true)

    const invalidated = captchaGateReducer(verified, { type: "invalidated" })
    expect(invalidated).toEqual(initialCaptchaGateState)
    expect(isCaptchaGateReady(invalidated)).toBe(false)
  })
})

describe("runCaptchaAttempt", () => {
  it("成功时把当前 token 传给请求，并在完成后重置一次", async () => {
    const reset = vi.fn()
    const request = vi.fn(async (token: string) => `ok:${token}`)

    await expect(runCaptchaAttempt("token-1", reset, request)).resolves.toBe("ok:token-1")
    expect(request).toHaveBeenCalledWith("token-1")
    expect(reset).toHaveBeenCalledTimes(1)
  })

  it("失败或网络结果不明时保留原错误，并在抛出前重置一次", async () => {
    const reset = vi.fn()
    const error = new TypeError("network failed")

    await expect(
      runCaptchaAttempt("token-2", reset, async () => {
        throw error
      }),
    ).rejects.toBe(error)
    expect(reset).toHaveBeenCalledTimes(1)
  })
})
