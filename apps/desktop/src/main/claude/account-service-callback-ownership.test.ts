// 验证授权结束或取消时，浏览器退出之前始终保留本次回调和 Xray 资源。

import { expect, it } from "vitest"
import {
  createHarness,
  createWaitingCallback,
  fingerprint,
  seedAccount,
} from "./account-service-test-fixtures"
import { BrowserLaunchError } from "./fingerprint-chromium"

it("取消等待后，浏览器退出前不释放回调端口或 Xray", async () => {
  let releaseStop: () => void = () => undefined
  let observeStop: () => void = () => undefined
  let observeWaiting: () => void = () => undefined
  const stopping = new Promise<void>((resolve) => {
    observeStop = resolve
  })
  const waiting = new Promise<void>((resolve) => {
    observeWaiting = resolve
  })
  const stopGate = new Promise<void>((resolve) => {
    releaseStop = resolve
  })
  let closed = false
  const waitingCallback = createWaitingCallback()
  const callback = {
    ...waitingCallback,
    waitForCode: () => {
      observeWaiting()
      return waitingCallback.waitForCode()
    },
    close: async () => {
      closed = true
      await waitingCallback.close()
    },
  }
  const harness = await createHarness({
    callback,
    stopWait: async () => {
      observeStop()
      await stopGate
    },
  })
  const pending = harness.service
    .authorize({ displayName: "合成账号", proxyId: "p1", fingerprint })
    .catch((error: unknown) => error)
  await waiting
  const cancelling = harness.service.cancel()
  try {
    await stopping
    expect(closed).toBe(false)
    expect(harness.bridgeClosed()).toBe(false)
  } finally {
    releaseStop()
    await cancelling
    expect(await pending).toMatchObject({ code: "AUTHORIZATION_CANCELLED" })
    await harness.cleanup()
  }
  expect(closed).toBe(true)
  expect(harness.bridgeClosed()).toBe(true)
})

it("浏览器停止失败时保留回调和 Xray，重试成功后再释放", async () => {
  let stops = 0
  let closed = false
  const callback = {
    redirectUri: "http://localhost:1234/callback",
    isComplete: () => true,
    waitForCode: async () => "synthetic-code",
    cancel: () => undefined,
    close: async () => {
      closed = true
    },
  }
  const harness = await createHarness({
    callback,
    stopWait: async () => {
      stops += 1
      if (stops === 1) throw new BrowserLaunchError("BROWSER_STOP_FAILED", "浏览器仍在运行")
    },
  })
  try {
    await harness.service.authorize({ displayName: "合成账号", proxyId: "p1", fingerprint })
    expect(closed).toBe(false)
    expect(harness.bridgeClosed()).toBe(false)
    await harness.service.cancel()
    expect(stops).toBe(2)
    expect(closed).toBe(true)
    expect(harness.bridgeClosed()).toBe(true)
  } finally {
    await harness.cleanup()
  }
})

it("授权清理失败时不删除账号或配置目录", async () => {
  let observeWaiting: () => void = () => undefined
  const waiting = new Promise<void>((resolve) => {
    observeWaiting = resolve
  })
  let allowClose = false
  const waitingCallback = createWaitingCallback()
  const callback = {
    ...waitingCallback,
    waitForCode: () => {
      observeWaiting()
      return waitingCallback.waitForCode()
    },
    close: async () => {
      if (!allowClose) throw new Error("回调关闭失败")
      await waitingCallback.close()
    },
  }
  const harness = await createHarness({ callback })
  try {
    await harness.store.saveAccount(seedAccount())
    const pending = harness.service
      .authorize({ accountId: "acc-1", displayName: "合成账号", proxyId: "p1", fingerprint })
      .catch((error: unknown) => error)
    await waiting
    await expect(harness.service.remove("acc-1")).rejects.toMatchObject({
      code: "UNEXPECTED_ERROR",
    })
    expect(await pending).toMatchObject({ code: "AUTHORIZATION_CANCELLED" })
    expect(await harness.store.getAccount("acc-1")).not.toBeNull()
    expect(harness.browserCalls).not.toContain("delete")
    allowClose = true
    await harness.service.cancel()
  } finally {
    await harness.cleanup()
  }
})

it("授权结束后仍有未回收资源时不删除账号", async () => {
  const callback = {
    redirectUri: "http://localhost:1234/callback",
    isComplete: () => true,
    waitForCode: async () => "synthetic-code",
    cancel: () => undefined,
    close: async () => undefined,
  }
  const harness = await createHarness({
    callback,
    stopWait: async () => {
      throw new BrowserLaunchError("BROWSER_STOP_FAILED", "浏览器仍在运行")
    },
  })
  try {
    await harness.service.authorize({ displayName: "合成账号", proxyId: "p1", fingerprint })
    await expect(harness.service.remove("acc-1")).rejects.toMatchObject({
      code: "BROWSER_STOP_FAILED",
    })
    expect(await harness.store.getAccount("acc-1")).not.toBeNull()
    expect(harness.browserCalls).not.toContain("delete")
  } finally {
    await harness.cleanup()
  }
})
