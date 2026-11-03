// 验证出口核对期间取消或 Xray 恢复失败时及时结束授权。

import { expect, it } from "vitest"
import { createHarness, fingerprint } from "./account-service-test-fixtures"
import { ClaudeAccountError } from "./errors"

it.each(["cancel", "failure"] as const)(
  "出口核对期间发生 %s 时不启动浏览器",
  async (action) => {
    let observe: () => void = () => undefined
    let notifyFailure: (error: Error) => void = () => undefined
    const started = new Promise<void>((resolve) => {
      observe = resolve
    })
    const failure = new Promise<Error>((resolve) => {
      notifyFailure = resolve
    })
    let closed = false
    const harness = await createHarness({
      proxyRuntime: {
        url: "socks5://127.0.0.1:12345",
        failure,
        close: async () => {
          closed = true
        },
      },
      checkEgressWait: async ({ signal }) =>
        new Promise((_resolve, reject) => {
          if (signal?.aborted) reject(signal.reason)
          else signal?.addEventListener("abort", () => reject(signal.reason), { once: true })
          observe()
        }),
    })
    const authorization = harness.service
      .authorize({ displayName: "合成账号", proxyId: "p1", fingerprint })
      .catch((error: unknown) => error)
    try {
      await started
      const cancel = action === "cancel" ? harness.service.cancel() : undefined
      if (action === "failure")
        notifyFailure(new ClaudeAccountError("PROXY_UNAVAILABLE", "Xray 恢复失败"))
      const result = await authorization
      await cancel
      expect(result).toMatchObject({
        code: action === "cancel" ? "AUTHORIZATION_CANCELLED" : "PROXY_UNAVAILABLE",
      })
      expect(harness.browserCalls).not.toContain("launch")
      expect(harness.callbackCalls).toEqual([])
      expect(closed).toBe(true)
    } finally {
      await harness.cleanup()
    }
  },
  3_000,
)
