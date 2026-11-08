// 验证 Xray 按原端口恢复失败时，正在等待浏览器授权的账号收到错误。

import { expect, it } from "vitest"
import { createHarness, createWaitingCallback, fingerprint } from "./account-service-test-fixtures"
import type { ClaudeAccountServiceDeps } from "./account-service"
import { ClaudeAccountError } from "./errors"
import { SubscriptionOAuth } from "./subscription-oauth"

it("Xray 恢复失败后浏览器关闭期间回调不再显示授权完成", async () => {
  let notifyFailure: (error: Error) => void = () => undefined
  let releaseStop: () => void = () => undefined
  let observeStop: () => void = () => undefined
  const failure = new Promise<Error>((resolve) => {
    notifyFailure = resolve
  })
  const stopping = new Promise<void>((resolve) => {
    observeStop = resolve
  })
  const stop = new Promise<void>((resolve) => {
    releaseStop = resolve
  })
  const callback = await new SubscriptionOAuth().startCallback({ state: "synthetic-state" })
  const harness = await createHarness({
    callback,
    proxyRuntime: { url: "socks5://127.0.0.1:12345", failure, close: async () => undefined },
    stopWait: async () => {
      observeStop()
      await stop
    },
  })
  const authorization = harness.service
    .authorize({ displayName: "合成账号", proxyId: "p1", fingerprint })
    .catch((error: unknown) => error)
  try {
    await harness.launched.promise
    notifyFailure(new ClaudeAccountError("PROXY_UNAVAILABLE", "Xray 代理恢复失败"))
    await stopping
    const url = new URL(callback.redirectUri)
    url.hostname = "127.0.0.1"
    url.searchParams.set("state", "synthetic-state")
    url.searchParams.set("code", "synthetic-code")
    const body = await (await fetch(url)).text()
    expect(body).toContain("授权已结束")
    expect(body).not.toContain("授权完成")
    releaseStop()
    await expect(authorization).resolves.toMatchObject({ code: "PROXY_UNAVAILABLE" })
  } finally {
    releaseStop()
    await Promise.allSettled([authorization, callback.close()])
    await harness.cleanup()
  }
})

it("回调启动期间 Xray 恢复失败时，创建完成后立即取消回调", async () => {
  let notifyFailure: (error: Error) => void = () => undefined
  let releaseStart: () => void = () => undefined
  let observeStart: () => void = () => undefined
  const failure = new Promise<Error>((resolve) => {
    notifyFailure = resolve
  })
  const started = new Promise<void>((resolve) => {
    observeStart = resolve
  })
  const start = new Promise<void>((resolve) => {
    releaseStart = resolve
  })
  let cancelled = false
  const harness = await createHarness({
    callback: {
      redirectUri: "http://localhost:1234/callback",
      isComplete: () => true,
      waitForCode: async () => "code",
      cancel: () => {
        cancelled = true
      },
      close: async () => undefined,
    },
    callbackStartWait: async () => {
      observeStart()
      await start
    },
    proxyRuntime: { url: "socks5://127.0.0.1:12345", failure, close: async () => undefined },
  })
  const authorization = harness.service
    .authorize({ displayName: "合成账号", proxyId: "p1", fingerprint })
    .catch((error: unknown) => error)
  try {
    await started
    notifyFailure(new ClaudeAccountError("PROXY_UNAVAILABLE", "Xray 代理恢复失败"))
    await Promise.resolve()
    releaseStart()
    await expect(authorization).resolves.toMatchObject({ code: "PROXY_UNAVAILABLE" })
    expect(cancelled).toBe(true)
    expect(harness.browserCalls).not.toContain("launch")
  } finally {
    releaseStart()
    await authorization
    await harness.cleanup()
  }
})

it("Xray 恢复失败时结束授权并报告代理不可用", async () => {
  let notifyFailure: (error: Error) => void = () => undefined
  let notifyWaiting: () => void = () => undefined
  const failure = new Promise<Error>((resolve) => {
    notifyFailure = resolve
  })
  const waiting = new Promise<void>((resolve) => {
    notifyWaiting = resolve
  })
  let closed = false
  const waitingCallback = createWaitingCallback()
  const harness = await createHarness({
    proxyRuntime: {
      url: "socks5://127.0.0.1:12345",
      failure,
      close: async () => {
        closed = true
      },
      assertRunning: () => undefined,
    },
    callback: {
      ...waitingCallback,
      waitForCode: () => {
        notifyWaiting()
        return waitingCallback.waitForCode()
      },
    },
  })
  const authorization = harness.service
    .authorize({ displayName: "合成账号", proxyId: "p1", fingerprint })
    .catch((error: unknown) => error)
  try {
    await waiting
    notifyFailure(new ClaudeAccountError("PROXY_UNAVAILABLE", "Xray 代理恢复失败"))
    const result = await Promise.race([
      authorization,
      new Promise((resolve) => setTimeout(() => resolve("timeout"), 500)),
    ])
    expect(result).toMatchObject({ code: "PROXY_UNAVAILABLE" })
    expect(harness.browserCalls).toContain("stop")
    expect(closed).toBe(true)
  } finally {
    waitingCallback.cancel()
    await authorization
    await harness.cleanup()
  }
})

it.each(["exchange", "profile"] as const)("Xray 恢复失败时中止进行中的 %s 请求", async (phase) => {
  let notifyFailure: (error: Error) => void = () => undefined
  let observeStart: () => void = () => undefined
  let forceReject: (error: Error) => void = () => undefined
  const failure = new Promise<Error>((resolve) => {
    notifyFailure = resolve
  })
  const started = new Promise<void>((resolve) => {
    observeStart = resolve
  })
  const wait = (signal?: AbortSignal): Promise<never> =>
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
      isComplete: () => true,
      waitForCode: async () => "code",
      cancel: () => undefined,
      close: async () => undefined,
    }),
    exchangeCode: async (input) =>
      phase === "exchange"
        ? wait(input.signal)
        : {
            accessToken: "synthetic",
            refreshToken: "synthetic",
            expiresAt: Date.now() + 60_000,
            scopes: [],
          },
    readProfile: async (input) => (phase === "profile" ? wait(input.signal) : null),
  }
  const harness = await createHarness({
    oauth,
    proxyRuntime: {
      url: "socks5://127.0.0.1:12345",
      failure,
      close: async () => undefined,
      assertRunning: () => undefined,
    },
  })
  const authorization = harness.service
    .authorize({ displayName: "合成账号", proxyId: "p1", fingerprint })
    .catch((error: unknown) => error)
  try {
    await started
    notifyFailure(new ClaudeAccountError("PROXY_UNAVAILABLE", "Xray 代理恢复失败"))
    const result = await Promise.race([
      authorization,
      new Promise((resolve) => setTimeout(() => resolve("timeout"), 500)),
    ])
    expect(result).toMatchObject({ code: "PROXY_UNAVAILABLE" })
    expect(await harness.store.getAccount("acc-1")).toBeNull()
  } finally {
    forceReject(new Error("测试结束"))
    await authorization
    await harness.cleanup()
  }
})
