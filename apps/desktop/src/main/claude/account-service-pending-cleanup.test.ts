// 验证一个账号的浏览器未确认退出时，其他已开始的授权也不能启动浏览器。

import { expect, it } from "vitest"
import { createHarness, fingerprint, seedAccount } from "./account-service-test-fixtures"
import { BrowserLaunchError } from "./fingerprint-chromium"

it("rechecks pending cleanup after another account has passed the entry gate", async () => {
  let releaseMembership: () => void = () => undefined
  let enterMembership: () => void = () => undefined
  let resolveCode: (code: string) => void = () => undefined
  const membershipGate = new Promise<void>((resolve) => {
    releaseMembership = resolve
  })
  const entered = new Promise<void>((resolve) => {
    enterMembership = resolve
  })
  const code = new Promise<string>((resolve) => {
    resolveCode = resolve
  })
  let calls = 0
  const harness = await createHarness({
    callback: {
      redirectUri: "http://localhost:1234/callback",
      waitForCode: () => code,
      cancel: () => undefined,
      close: async () => undefined,
    },
    membershipWait: () => {
      calls++
      if (calls === 1) return Promise.resolve()
      enterMembership()
      return membershipGate
    },
    stopError: new BrowserLaunchError("BROWSER_STOP_FAILED", "浏览器可能仍在运行"),
  })
  await harness.store.saveAccount({ ...seedAccount(), id: "acc-2" })
  const first = harness.service.authorize({ displayName: "第一个", proxyId: null, fingerprint })
  await harness.launched.promise
  const second = harness.service
    .authorize({
      accountId: "acc-2",
      displayName: "第二个",
      proxyId: null,
      fingerprint,
    })
    .catch((error: unknown) => error)
  await entered
  resolveCode("synthetic-code")
  await first
  releaseMembership()
  expect(await second).toMatchObject({ code: "BROWSER_STOP_FAILED" })
  expect(harness.browserCalls.filter((call) => call === "launch")).toHaveLength(1)
})

it("回调正在关闭时不启动另一个浏览器，关闭失败后保留资源", async () => {
  let observeClose: () => void = () => undefined
  let releaseClose: () => void = () => undefined
  const closing = new Promise<void>((resolve) => {
    observeClose = resolve
  })
  const gate = new Promise<void>((resolve) => {
    releaseClose = resolve
  })
  const callback = {
    redirectUri: "http://localhost:1234/callback",
    waitForCode: async () => "synthetic-code",
    cancel: () => undefined,
    close: async () => {
      observeClose()
      await gate
      throw new Error("回调关闭失败")
    },
  }
  const harness = await createHarness({ callback })
  let first: Promise<unknown> | undefined
  let second: Promise<unknown> | undefined
  try {
    await harness.store.saveAccount({ ...seedAccount(), id: "acc-2" })
    first = harness.service.authorize({ displayName: "第一个", proxyId: "p1", fingerprint })
    await closing
    second = harness.service
      .authorize({ accountId: "acc-2", displayName: "第二个", proxyId: "p1", fingerprint })
      .catch((error: unknown) => error)
    await Promise.race([second, new Promise((resolve) => setTimeout(resolve, 200))])
    expect(harness.browserCalls.filter((call) => call === "launch")).toHaveLength(1)
    expect(await second).toMatchObject({ code: "BROWSER_STOP_FAILED" })
    releaseClose()
    await first
  } finally {
    releaseClose()
    await Promise.allSettled([first, second])
    await harness.cleanup()
  }
})
