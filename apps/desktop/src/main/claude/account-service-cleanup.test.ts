// 验证并发重试不会提前丢失仍在关闭的授权资源。

import { expect, it } from "vitest"
import { AuthorizationResourceCleanup } from "./account-service-cleanup"
import { BrowserLaunchError } from "./fingerprint-chromium"

it("并发重试共享在途清理，失败后仍能再次重试", async () => {
  const cleanup = new AuthorizationResourceCleanup()
  let stops = 0
  let closes = 0
  let release: () => void = () => undefined
  let entered: () => void = () => undefined
  const closeStarted = new Promise<void>((resolve) => {
    entered = resolve
  })
  const closeGate = new Promise<void>((resolve) => {
    release = resolve
  })
  const resources = {
    browser: {
      profileDir: "/synthetic",
      pid: 1234,
      stop: async () => {
        stops += 1
        if (stops === 1) throw new BrowserLaunchError("BROWSER_STOP_FAILED", "未退出")
      },
    },
    callback: {
      redirectUri: "http://localhost:1234/callback",
      waitForCode: async () => "code",
      cancel: () => undefined,
      close: async () => {
        closes += 1
        if (closes === 1) {
          entered()
          await closeGate
          throw new Error("关闭失败")
        }
      },
    },
    proxy: null,
  }
  expect(await cleanup.close("account", resources)).toMatchObject({ code: "BROWSER_STOP_FAILED" })
  const first = cleanup.retry().catch((error: unknown) => error)
  await closeStarted
  const second = cleanup.retry().catch((error: unknown) => error)
  try {
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(closes).toBe(1)
  } finally {
    release()
    await Promise.all([first, second])
  }
  expect(cleanup.hasPending).toBe(true)
  await cleanup.retry()
  expect(cleanup.hasPending).toBe(false)
})
