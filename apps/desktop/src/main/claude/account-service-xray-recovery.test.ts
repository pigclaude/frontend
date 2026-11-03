// 验证授权回调在 Xray 恢复期间到达时等待原端口恢复。

import { expect, it } from "vitest"
import { createHarness, fingerprint } from "./account-service-test-fixtures"
import { createXrayRuntimePool, type XrayCoreRuntime } from "./xray-runtime-pool"

it("回调到达时 Xray 正在恢复，等待恢复后继续授权", async () => {
  let exit: () => void = () => undefined
  let releaseRestart: (value: XrayCoreRuntime) => void = () => undefined
  let observeRestart: () => void = () => undefined
  let deliverCode: (code: string) => void = () => undefined
  let observeWaiting: () => void = () => undefined
  const exited = new Promise<void>((resolve) => {
    exit = resolve
  })
  const restarting = new Promise<void>((resolve) => {
    observeRestart = resolve
  })
  const waiting = new Promise<void>((resolve) => {
    observeWaiting = resolve
  })
  let starts = 0
  const pool = createXrayRuntimePool(async () => {
    starts += 1
    if (starts === 1)
      return { url: "socks5://127.0.0.1:12345", exited, close: async () => undefined }
    observeRestart()
    return new Promise<XrayCoreRuntime>((resolve) => {
      releaseRestart = resolve
    })
  }, 0)
  const runtime = await pool({ upstreamProxyUrl: "http://127.0.0.1:9" })
  const harness = await createHarness({
    proxyRuntime: runtime,
    callback: {
      redirectUri: "http://localhost:1234/callback",
      waitForCode: () =>
        new Promise<string>((resolve) => {
          deliverCode = resolve
          observeWaiting()
        }),
      cancel: () => undefined,
      close: async () => undefined,
    },
  })
  const authorization = harness.service.authorize({
    displayName: "合成账号",
    proxyId: "p1",
    fingerprint,
  })
  let finished = false
  void authorization.then(
    () => {
      finished = true
    },
    () => {
      finished = true
    },
  )
  try {
    await waiting
    exit()
    await restarting
    deliverCode("synthetic-code")
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(finished).toBe(false)
    releaseRestart({
      url: runtime.url,
      exited: new Promise<void>(() => undefined),
      close: async () => undefined,
    })
    expect(await authorization).toMatchObject({ proxyId: "p1" })
  } finally {
    releaseRestart({
      url: runtime.url,
      exited: new Promise<void>(() => undefined),
      close: async () => undefined,
    })
    await Promise.allSettled([authorization, pool.dispose(), harness.cleanup()])
  }
})
