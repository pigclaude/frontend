// 验证浏览器启动期间取消或代理条件失效时，授权页面不会继续打开且子进程会退出。

import { EventEmitter } from "node:events"
import type { ChildProcess, spawn } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, it } from "vitest"
import { fingerprint } from "./account-service-test-fixtures"
import type { BrowserStartupInput } from "./browser-startup"
import { FingerprintChromiumAdapter } from "./fingerprint-chromium"

const cleanups: Array<() => Promise<void>> = []
const authorizeUrl = "https://example.test/authorize?state=synthetic"

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

it("扩展状态确认失败时结束浏览器并报告启动失败", async () => {
  const { adapter, child, args } = await createAdapter(async () => {
    throw new Error("synthetic readiness failure")
  })
  await expect(adapter.launch(input())).rejects.toMatchObject({ code: "BROWSER_START_FAILED" })
  expect(args()).not.toContain(authorizeUrl)
  expect(child.signals).toEqual(["SIGTERM"])
})

it("等待扩展期间代理条件失效时结束浏览器并保留原错误", async () => {
  let notify: () => void = () => undefined
  let release: () => void = () => undefined
  const entered = new Promise<void>((resolve) => {
    notify = resolve
  })
  const waiting = new Promise<void>((resolve) => {
    release = resolve
  })
  const { adapter, child } = await createAdapter(async ({ assertCanNavigate }) => {
    notify()
    await waiting
    assertCanNavigate?.()
  })
  const unavailable = new Error("synthetic proxy unavailable")
  let available = true
  const launching = adapter.launch({
    ...input(),
    assertCanSpawn: () => {
      if (!available) throw unavailable
    },
  })
  const outcome = launching.catch((error: unknown) => error)
  await entered
  available = false
  release()
  await expect(outcome).resolves.toBe(unavailable)
  expect(child.signals).toEqual(["SIGTERM"])
})

it("取消授权时结束正在等待扩展的浏览器", async () => {
  let notify: () => void = () => undefined
  const entered = new Promise<void>((resolve) => {
    notify = resolve
  })
  const { adapter, child } = await createAdapter(async ({ signal }) => {
    notify()
    await waitForCancellation(signal)
  })
  const controller = new AbortController()
  const cancelled = new Error("synthetic cancellation")
  const launching = adapter.launch({ ...input(), signal: controller.signal })
  const outcome = launching.catch((error: unknown) => error)
  await entered
  controller.abort(cancelled)
  await expect(outcome).resolves.toBe(cancelled)
  expect(child.signals).toEqual(["SIGTERM"])
})

it("关闭启动器时中止等待并结束浏览器", async () => {
  let notify: () => void = () => undefined
  const entered = new Promise<void>((resolve) => {
    notify = resolve
  })
  const { adapter, child } = await createAdapter(async ({ signal }) => {
    notify()
    await waitForCancellation(signal)
  })
  const launching = adapter.launch(input())
  const outcome = launching.catch((error: unknown) => error)
  await entered
  await adapter.dispose()
  await expect(outcome).resolves.toMatchObject({ code: "BROWSER_START_FAILED" })
  expect(child.signals).toEqual(["SIGTERM"])
})

function input() {
  return {
    accountId: "synthetic",
    authorizeUrl,
    network: {
      mode: "bound" as const,
      bridgeUrl: "socks5://127.0.0.1:49123",
      callbackUri: "http://localhost:49124/callback",
    },
    fingerprint,
  }
}

async function createAdapter(openPage: (input: BrowserStartupInput) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "browser-startup-failure-"))
  const child = new SyntheticChild()
  let values: string[] = []
  const syntheticSpawn = ((_binary: string, args: string[]) => {
    values = args
    queueMicrotask(() => child.emit("spawn"))
    return child as unknown as ChildProcess
  }) as typeof spawn
  const adapter = new FingerprintChromiumAdapter({
    hostArch: process.arch,
    binaryPath: process.execPath,
    profilesRoot: root,
    spawn: syntheticSpawn,
    openPage,
  })
  cleanups.push(async () => {
    await adapter.dispose()
    await rm(root, { recursive: true, force: true })
  })
  return { adapter, child, args: () => values }
}

function waitForCancellation(signal: AbortSignal | undefined): Promise<void> {
  if (signal === undefined) return Promise.reject(new Error("缺少取消信号"))
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true })
  })
}

class SyntheticChild extends EventEmitter {
  readonly pid = 4321
  readonly signals: NodeJS.Signals[] = []
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null

  unref(): void {}

  kill(signal: NodeJS.Signals): boolean {
    this.signals.push(signal)
    this.signalCode = signal
    queueMicrotask(() => this.emit("exit", null, signal))
    return true
  }
}
