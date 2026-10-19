// 负责验证公开配置等待上限、晚响应隔离及认证结束后的配置刷新。
// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import type { CaptchaConfig } from "@pigclaude/contracts/captcha"
import { useTurnstileCaptcha } from "./use-turnstile-captcha"
const config: CaptchaConfig = {
  enabled: true,
  provider: "turnstile",
  siteKey: "old-key",
  mode: "required",
}
afterEach(() => vi.useRealTimers())
it("pending_config_times_out_then_retries", async () => {
  vi.useFakeTimers()
  let late: ((value: CaptchaConfig) => void) | undefined
  let calls = 0
  const loadConfig = () =>
    ++calls === 1
      ? new Promise<CaptchaConfig>((resolve) => {
          late = resolve
        })
      : Promise.resolve({ ...config, siteKey: "new-key" })
  const { result } = renderHook(() => useTurnstileCaptcha({ loadConfig, action: "admin_login" }))
  await act(async () => {
    await vi.advanceTimersByTimeAsync(9999)
  })
  expect(result.current.ready).toBe(false)
  expect(result.current.field.error).toBeNull()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1)
  })
  expect(result.current.field.error).toContain("重试")
  await act(async () => {
    result.current.retry()
  })
  expect(result.current.field.config?.siteKey).toBe("new-key")
  await act(async () => {
    late?.(config)
  })
  expect(result.current.field.config?.siteKey).toBe("new-key")
})
it("settled_auth_reloads_changed_site_key", async () => {
  let calls = 0
  const loadConfig = async () => ({ ...config, siteKey: ++calls === 1 ? "old-key" : "new-key" })
  const { result } = renderHook(() => useTurnstileCaptcha({ loadConfig, action: "admin_login" }))
  await act(async () => {})
  const stale = result.current.field.onVerified
  act(() => result.current.field.onVerified("old-token"))
  await act(async () => {
    await result.current.run(async (token) => {
      expect(token).toBe("old-token")
    })
  })
  expect(result.current.field.config?.siteKey).toBe("new-key")
  act(() => stale("late-token"))
  expect(result.current.ready).toBe(false)
})
