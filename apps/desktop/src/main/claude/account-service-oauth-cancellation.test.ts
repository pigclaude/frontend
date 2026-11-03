// 验证用户取消会中止正在进行的授权交换或资料请求，并完成资源清理。

import { expect, it } from "vitest"
import { createHarness, fingerprint } from "./account-service-test-fixtures"
import type { ClaudeAccountServiceDeps } from "./account-service"

it.each(["exchange", "profile"] as const)("取消会中止 OAuth 的 %s 请求", async (phase) => {
  let observeStart: () => void = () => undefined
  let forceReject: (error: Error) => void = () => undefined
  const started = new Promise<void>((resolve) => {
    observeStart = resolve
  })
  const wait = (signal: AbortSignal | undefined): Promise<never> =>
    new Promise((_resolve, reject) => {
      forceReject = reject
      if (signal?.aborted) reject(signal.reason)
      else signal?.addEventListener("abort", () => reject(signal.reason), { once: true })
      observeStart()
    })
  const oauth: ClaudeAccountServiceDeps["oauth"] = {
    buildAuthorizeUrl: () => "https://synthetic.invalid/authorize",
    startCallback: async () => ({
      redirectUri: "http://localhost:1234/callback",
      waitForCode: async () => "code",
      cancel: () => undefined,
      close: async () => undefined,
    }),
    exchangeCode: async (input) => {
      if (phase === "exchange") return wait(input.signal)
      return {
        accessToken: "synthetic",
        refreshToken: "synthetic",
        expiresAt: Date.now() + 60_000,
        scopes: [],
      }
    },
    readProfile: async (input) => (phase === "profile" ? wait(input.signal) : null),
  }
  const harness = await createHarness({ oauth })
  const authorization = harness.service
    .authorize({ displayName: "合成账号", proxyId: "p1", fingerprint })
    .catch((error: unknown) => error)
  let cancelling: Promise<void> | undefined
  try {
    await started
    cancelling = harness.service.cancel()
    const promptlyCancelled = await Promise.race([
      cancelling.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 500)),
    ])
    expect(promptlyCancelled).toBe(true)
    expect(await authorization).toMatchObject({ code: "AUTHORIZATION_CANCELLED" })
    expect(harness.bridgeClosed()).toBe(true)
  } finally {
    forceReject(new Error("测试结束"))
    await Promise.allSettled([authorization, cancelling])
    await harness.cleanup()
  }
})
