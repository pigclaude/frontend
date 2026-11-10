// 验证浏览器启动失败且进程未确认退出时，授权回调与 Xray 持续保留以供清理重试。

import { EventEmitter } from "node:events"
import type { ChildProcess, spawn } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it, vi } from "vitest"
import { createHarness, createWaitingCallback, fingerprint } from "./account-service-test-fixtures"
import { BrowserProcessExitedError } from "./browser-control-pipe"
import { FingerprintChromiumAdapter } from "./fingerprint-chromium"
import { SubscriptionOAuth } from "./subscription-oauth"

it("启动失败但浏览器未退出时保留网络资源并阻止新授权", async () => {
  const root = await mkdtemp(join(tmpdir(), "browser-startup-cleanup-"))
  const child = new SyntheticChild()
  const syntheticSpawn = (() => {
    queueMicrotask(() => child.emit("spawn"))
    return child as unknown as ChildProcess
  }) as typeof spawn
  const adapter = new FingerprintChromiumAdapter({
    hostArch: process.arch,
    binaryPath: process.execPath,
    verifyEnvironmentBrowser: async () => true,
    profilesRoot: root,
    spawn: syntheticSpawn,
    stopTimeoutMs: 5,
    openPage: async () => {
      throw new Error("synthetic startup failure")
    },
  })
  const closeCallback = vi.fn(async () => undefined)
  const closeProxy = vi.fn(async () => undefined)
  const harness = await createHarness({
    browser: adapter,
    callback: {
      redirectUri: "http://localhost:1234/callback",
      isComplete: () => true,
      waitForCode: async () => "synthetic-code",
      cancel: () => undefined,
      close: closeCallback,
    },
    proxyRuntime: { url: "socks5://127.0.0.1:49123", close: closeProxy },
  })
  try {
    await expect(
      harness.service.authorize({ displayName: "合成账号", proxyId: "p1", fingerprint }),
    ).rejects.toMatchObject({ code: "BROWSER_STOP_FAILED" })
    expect(closeCallback).not.toHaveBeenCalled()
    expect(closeProxy).not.toHaveBeenCalled()
    await expect(
      harness.service.authorize({ displayName: "另一个账号", proxyId: "p1", fingerprint }),
    ).rejects.toMatchObject({ code: "BROWSER_STOP_FAILED" })
    child.finish()
    await harness.service.cancel()
    expect(closeCallback).toHaveBeenCalledOnce()
    expect(closeProxy).toHaveBeenCalledOnce()
  } finally {
    child.finish()
    await harness.service.cancel().catch(() => undefined)
    await adapter.dispose().catch(() => undefined)
    await harness.cleanup()
    await rm(root, { recursive: true, force: true })
  }
}, 10_000)

it("授权窗口在启动期间关闭时按取消授权处理", async () => {
  const waiting = createWaitingCallback()
  const closeCallback = vi.fn(waiting.close)
  const closeProxy = vi.fn(async () => undefined)
  const harness = await createHarness({
    browser: {
      ensureAvailable: async () => "/synthetic/browser",
      profileDir: () => "/synthetic/profile",
      launch: async () => {
        throw new BrowserProcessExitedError()
      },
      deleteProfile: async () => undefined,
      dispose: async () => undefined,
    },
    callback: { ...waiting, close: closeCallback },
    proxyRuntime: { url: "socks5://127.0.0.1:49123", close: closeProxy },
  })
  try {
    await expect(
      harness.service.authorize({ displayName: "合成账号", proxyId: "p1", fingerprint }),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_CANCELLED" })
    expect(closeCallback).toHaveBeenCalledOnce()
    expect(closeProxy).toHaveBeenCalledOnce()
  } finally {
    await harness.cleanup()
  }
})

it("启动失败且浏览器未退出时保留监听，但拒绝迟到的授权回调", async () => {
  const root = await mkdtemp(join(tmpdir(), "browser-startup-callback-"))
  const child = new SyntheticChild()
  const syntheticSpawn = (() => {
    queueMicrotask(() => child.emit("spawn"))
    return child as unknown as ChildProcess
  }) as typeof spawn
  const adapter = new FingerprintChromiumAdapter({
    hostArch: process.arch,
    binaryPath: process.execPath,
    verifyEnvironmentBrowser: async () => true,
    profilesRoot: root,
    spawn: syntheticSpawn,
    stopTimeoutMs: 5,
    openPage: async () => {
      throw new Error("synthetic startup failure")
    },
  })
  const callback = await new SubscriptionOAuth().startCallback({ state: "synthetic" })
  const closeProxy = vi.fn(async () => undefined)
  const harness = await createHarness({
    browser: adapter,
    callback,
    proxyRuntime: { url: "socks5://127.0.0.1:49123", close: closeProxy },
  })
  try {
    await expect(
      harness.service.authorize({ displayName: "合成账号", proxyId: "p1", fingerprint }),
    ).rejects.toMatchObject({ code: "BROWSER_STOP_FAILED" })
    expect(callback.isComplete()).toBe(true)
    expect(closeProxy).not.toHaveBeenCalled()
    const response = await fetch(`${callback.redirectUri}?state=synthetic&code=synthetic-code`)
    expect(await response.text()).toContain("授权已结束")
    child.finish()
    await harness.service.cancel()
    expect(closeProxy).toHaveBeenCalledOnce()
  } finally {
    child.finish()
    await harness.service.cancel().catch(() => undefined)
    await adapter.dispose().catch(() => undefined)
    await callback.close()
    await harness.cleanup()
    await rm(root, { recursive: true, force: true })
  }
}, 10_000)

class SyntheticChild extends EventEmitter {
  readonly pid = 4321
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null

  unref(): void {}

  kill(): boolean {
    return true
  }

  finish(): void {
    if (this.exitCode !== null || this.signalCode !== null) return
    this.signalCode = "SIGKILL"
    this.emit("exit", null, "SIGKILL")
  }
}
