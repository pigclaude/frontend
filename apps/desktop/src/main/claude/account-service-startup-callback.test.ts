// 验证浏览器启动期间已完成的授权回调不会因随后窗口退出而丢失。

import { expect, it } from "vitest"
import { createHarness, fingerprint } from "./account-service-test-fixtures"
import { BrowserProcessExitedError } from "./browser-control-pipe"
import type { LaunchedBrowser } from "./fingerprint-chromium"
import { SubscriptionOAuthError } from "./subscription-oauth"

it("回调已收到授权码后浏览器退出，仍完成该次授权", async () => {
  let resolveCode: (code: string) => void = () => undefined
  let rejectLaunch: (error: Error) => void = () => undefined
  let notifyLaunch: () => void = () => undefined
  let completed: { kind: "code"; code: string } | null = null
  const code = new Promise<string>((resolve) => {
    resolveCode = resolve
  })
  const started = new Promise<void>((resolve) => {
    notifyLaunch = resolve
  })
  const browserLaunch = new Promise<LaunchedBrowser>((_resolve, reject) => {
    rejectLaunch = reject
  })
  const harness = await createHarness({
    browser: {
      ensureAvailable: async () => "/synthetic/browser",
      profileDir: () => "/synthetic/profile",
      launch: () => {
        notifyLaunch()
        return browserLaunch
      },
      deleteProfile: async () => undefined,
      dispose: async () => undefined,
    },
    callback: {
      redirectUri: "http://localhost:1234/callback",
      waitForCode: async () => await code,
      isComplete: () => completed !== null,
      cancel: () => undefined,
      close: async () => undefined,
    },
  })
  try {
    const authorization = harness.service.authorize({
      displayName: "合成账号",
      proxyId: "p1",
      fingerprint,
    })
    await started
    completed = { kind: "code", code: "synthetic-code" }
    resolveCode("synthetic-code")
    rejectLaunch(new BrowserProcessExitedError())
    await expect(authorization).resolves.toMatchObject({ displayName: "合成账号" })
    expect(harness.events.some((event) => event.phase === "authorized")).toBe(true)
  } finally {
    await harness.cleanup()
  }
})

it("浏览器启动后回调先完成、窗口同轮退出时仍处理授权码", async () => {
  let resolveCode: (code: string) => void = () => undefined
  let resolveExit: () => void = () => undefined
  let notifyLaunch: () => void = () => undefined
  let completed = false
  const code = new Promise<string>((resolve) => {
    resolveCode = resolve
  })
  const exited = new Promise<void>((resolve) => {
    resolveExit = resolve
  })
  const started = new Promise<void>((resolve) => {
    notifyLaunch = resolve
  })
  const harness = await createHarness({
    browser: {
      ensureAvailable: async () => "/synthetic/browser",
      profileDir: () => "/synthetic/profile",
      launch: async () => {
        notifyLaunch()
        return { profileDir: "/synthetic/profile", pid: 1, exited, stop: async () => undefined }
      },
      deleteProfile: async () => undefined,
      dispose: async () => undefined,
    },
    callback: {
      redirectUri: "http://localhost:1234/callback",
      waitForCode: async () => await code,
      isComplete: () => completed,
      cancel: () => undefined,
      close: async () => undefined,
    },
  })
  try {
    const authorization = harness.service.authorize({
      displayName: "合成账号",
      proxyId: "p1",
      fingerprint,
    })
    await started
    await new Promise<void>((resolve) => setImmediate(resolve))
    completed = true
    resolveCode("synthetic-code")
    resolveExit()
    await expect(authorization).resolves.toMatchObject({ displayName: "合成账号" })
  } finally {
    await harness.cleanup()
  }
})

it("启动期间回调校验失败时立即中止浏览器启动", async () => {
  let rejectCode: (error: Error) => void = () => undefined
  let rejectLaunch: (error: Error) => void = () => undefined
  let notifyLaunch: () => void = () => undefined
  let launchSignal: AbortSignal | undefined
  let complete = false
  const code = new Promise<string>((_resolve, reject) => {
    rejectCode = (error) => {
      complete = true
      reject(error)
    }
  })
  const started = new Promise<void>((resolve) => {
    notifyLaunch = resolve
  })
  const browserLaunch = new Promise<LaunchedBrowser>((_resolve, reject) => {
    rejectLaunch = reject
  })
  const harness = await createHarness({
    browser: {
      ensureAvailable: async () => "/synthetic/browser",
      profileDir: () => "/synthetic/profile",
      launch: (input) => {
        launchSignal = input.signal
        input.signal?.addEventListener("abort", () => rejectLaunch(input.signal?.reason), {
          once: true,
        })
        notifyLaunch()
        return browserLaunch
      },
      deleteProfile: async () => undefined,
      dispose: async () => undefined,
    },
    callback: {
      redirectUri: "http://localhost:1234/callback",
      isComplete: () => complete,
      waitForCode: () => code,
      cancel: () => undefined,
      close: async () => undefined,
    },
  })
  const authorization = harness.service
    .authorize({ displayName: "合成账号", proxyId: "p1", fingerprint })
    .catch((error: unknown) => error)
  try {
    await started
    rejectCode(new SubscriptionOAuthError("OAUTH_STATE_MISMATCH", "合成 state 不匹配"))
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(launchSignal?.aborted).toBe(true)
    await expect(authorization).resolves.toMatchObject({ code: "OAUTH_STATE_MISMATCH" })
  } finally {
    rejectLaunch(new BrowserProcessExitedError())
    await authorization
    await harness.cleanup()
  }
})

it("回调错误与导航准备同轮完成时，不打开授权页面", async () => {
  let rejectCode: (error: Error) => void = () => undefined
  let releaseNavigation: () => void = () => undefined
  let notifyLaunch: () => void = () => undefined
  let complete = false
  let navigated = false
  const code = new Promise<string>((_resolve, reject) => {
    rejectCode = reject
  })
  const waiting = new Promise<void>((resolve) => {
    releaseNavigation = resolve
  })
  const started = new Promise<void>((resolve) => {
    notifyLaunch = resolve
  })
  const harness = await createHarness({
    browser: {
      ensureAvailable: async () => "/synthetic/browser",
      profileDir: () => "/synthetic/profile",
      launch: async (input) => {
        notifyLaunch()
        await waiting
        input.assertCanNavigate?.()
        navigated = true
        return {
          profileDir: "/synthetic/profile",
          pid: 1,
          exited: new Promise<void>(() => undefined),
          stop: async () => undefined,
        }
      },
      deleteProfile: async () => undefined,
      dispose: async () => undefined,
    },
    callback: {
      redirectUri: "http://localhost:1234/callback",
      waitForCode: async () => await code,
      isComplete: () => complete,
      cancel: () => undefined,
      close: async () => undefined,
    },
  })
  const authorization = harness.service
    .authorize({ displayName: "合成账号", proxyId: "p1", fingerprint })
    .catch((error: unknown) => error)
  try {
    await started
    complete = true
    rejectCode(new SubscriptionOAuthError("OAUTH_STATE_MISMATCH", "合成 state 不匹配"))
    releaseNavigation()
    await expect(authorization).resolves.toMatchObject({ code: "OAUTH_STATE_MISMATCH" })
    expect(navigated).toBe(false)
  } finally {
    releaseNavigation()
    await authorization
    await harness.cleanup()
  }
})
