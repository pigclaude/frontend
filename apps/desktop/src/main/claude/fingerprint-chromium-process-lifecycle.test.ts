// 验证浏览器进程的退出、并发停止和配置目录删除边界。

import { EventEmitter } from "node:events"
import type { ChildProcess, spawn } from "node:child_process"
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, it, vi } from "vitest"
import type { ClaudeFingerprintView } from "@pigclaude/contracts/claude-account"
import { FingerprintChromiumAdapter } from "./fingerprint-chromium"

const roots: string[] = []
const fingerprint: ClaudeFingerprintView = {
  seed: "42",
  brand: "Chrome",
  platform: "macos",
  lang: "en-US",
  timezone: "UTC",
  canvasNoise: "",
  clientRectsNoise: "",
}

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

it("keeps an unresponsive process tracked after stop fails", async () => {
  const { adapter, child } = await createAdapter()
  await adapter.launch(input())
  vi.useFakeTimers()
  const stopping = adapter.stop("account")
  const outcome = stopping.then(
    () => ({ status: "resolved" }),
    (error: unknown) => ({ status: "rejected", error }),
  )
  await vi.advanceTimersByTimeAsync(1_100)
  expect(await outcome).toMatchObject({
    status: "rejected",
    error: { code: "BROWSER_STOP_FAILED" },
  })
  vi.useRealTimers()

  child.exitOnTerm = true
  await adapter.stop("account")
  expect(child.signals).toEqual(["SIGTERM", "SIGKILL", "SIGTERM"])
})

it("does not delete a profile while its process has not exited", async () => {
  const { adapter, root } = await createAdapter()
  const launched = await adapter.launch(input())
  await writeFile(join(launched.profileDir, "marker"), "kept")
  vi.useFakeTimers()
  const removing = adapter.deleteProfile("account")
  const outcome = removing.then(
    () => ({ status: "resolved" }),
    (error: unknown) => ({ status: "rejected", error }),
  )
  await vi.advanceTimersByTimeAsync(1_100)
  expect(await outcome).toMatchObject({
    status: "rejected",
    error: { code: "BROWSER_STOP_FAILED" },
  })
  vi.useRealTimers()
  expect((await stat(join(root, "account", "marker"))).isFile()).toBe(true)
})

it("waits for the same process exit when stop is called concurrently", async () => {
  const { adapter, child } = await createAdapter()
  await adapter.launch(input())
  const first = adapter.stop("account")
  const second = adapter.stop("account")
  let secondFinished = false
  void second.then(() => {
    secondFinished = true
  })
  await Promise.resolve()
  await Promise.resolve()
  expect(secondFinished).toBe(false)
  expect(child.signals).toEqual(["SIGTERM"])
  child.finish("SIGTERM")
  await Promise.all([first, second])
  expect(child.signals).toEqual(["SIGTERM"])
})

it("does not signal a process that exited immediately after spawning", async () => {
  const { adapter, child } = await createAdapter(true)
  await adapter.launch(input())
  await adapter.stop("account")
  expect(child.signals).toEqual([])
})

it("waits for an in-flight launch before stopping all processes", async () => {
  const root = await mkdtemp(join(tmpdir(), "browser-lifecycle-"))
  roots.push(root)
  const child = new FakeChild()
  child.exitOnTerm = true
  let notifySpawn: () => void = () => undefined
  const spawned = new Promise<void>((resolve) => {
    notifySpawn = resolve
  })
  const fakeSpawn = (() => {
    notifySpawn()
    return child as unknown as ChildProcess
  }) as typeof spawn
  const adapter = new FingerprintChromiumAdapter({
    binaryPath: process.execPath,
    profilesRoot: root,
    spawn: fakeSpawn,
  })
  const launching = adapter.launch(input())
  await spawned
  const stopping = adapter.stopAll()
  let finished = false
  void stopping.then(() => {
    finished = true
  })
  await Promise.resolve()
  expect(finished).toBe(false)
  child.emit("spawn")
  await launching
  await stopping
  expect(child.signals).toEqual(["SIGTERM"])
})

it("serializes concurrent launches for the same account", async () => {
  const root = await mkdtemp(join(tmpdir(), "browser-lifecycle-"))
  roots.push(root)
  const children: FakeChild[] = []
  let notifyFirstSpawn: () => void = () => undefined
  const firstSpawned = new Promise<void>((resolve) => {
    notifyFirstSpawn = resolve
  })
  const fakeSpawn = (() => {
    const child = new FakeChild()
    child.exitOnTerm = true
    children.push(child)
    if (children.length === 1) notifyFirstSpawn()
    else queueMicrotask(() => child.emit("spawn"))
    return child as unknown as ChildProcess
  }) as typeof spawn
  const adapter = new FingerprintChromiumAdapter({
    binaryPath: process.execPath,
    profilesRoot: root,
    spawn: fakeSpawn,
  })
  const availability = vi.spyOn(adapter, "ensureAvailable").mockResolvedValue(process.execPath)
  const first = adapter.launch(input())
  await firstSpawned
  const second = adapter.launch(input())
  await Promise.resolve()
  expect(children).toHaveLength(1)
  expect(availability).toHaveBeenCalledTimes(1)
  children[0]?.emit("spawn")
  await Promise.all([first, second])
  expect(children).toHaveLength(2)
  expect(children[0]?.signals).toEqual(["SIGTERM"])
  expect(children[1]?.signals).toEqual([])
})

it("does not let an old launch handle stop a newer instance", async () => {
  const root = await mkdtemp(join(tmpdir(), "browser-lifecycle-"))
  roots.push(root)
  const children: FakeChild[] = []
  const fakeSpawn = (() => {
    const child = new FakeChild()
    child.exitOnTerm = true
    children.push(child)
    queueMicrotask(() => child.emit("spawn"))
    return child as unknown as ChildProcess
  }) as typeof spawn
  const adapter = new FingerprintChromiumAdapter({
    binaryPath: process.execPath,
    profilesRoot: root,
    spawn: fakeSpawn,
  })
  const first = await adapter.launch(input())
  const second = await adapter.launch(input())
  await first.stop()
  expect(children[0]?.signals).toEqual(["SIGTERM"])
  expect(children[1]?.signals).toEqual([])
  await second.stop()
  expect(children[1]?.signals).toEqual(["SIGTERM"])
})

it("rejects a pending and later launch when disposed before the binary check completes", async () => {
  const { adapter, child } = await createAdapter()
  let release: (path: string) => void = () => undefined
  let entered: () => void = () => undefined
  const checking = new Promise<void>((resolve) => {
    entered = resolve
  })
  vi.spyOn(adapter, "ensureAvailable").mockImplementation(
    () =>
      new Promise<string>((resolve) => {
        release = resolve
        entered()
      }),
  )
  const launching = adapter.launch(input())
  const outcome = launching.then(
    () => ({ status: "resolved" }),
    (error: unknown) => ({ status: "rejected", error }),
  )
  await checking
  const disposing = adapter.dispose()
  release(process.execPath)
  expect(await outcome).toMatchObject({
    status: "rejected",
    error: { code: "BROWSER_START_FAILED" },
  })
  await disposing
  await expect(adapter.launch(input())).rejects.toMatchObject({ code: "BROWSER_START_FAILED" })
  expect(child.signals).toEqual([])
})

it("does not spawn when the authorization is cancelled during the binary check", async () => {
  const { adapter, child } = await createAdapter()
  let release: (path: string) => void = () => undefined
  let entered: () => void = () => undefined
  const checking = new Promise<void>((resolve) => {
    entered = resolve
  })
  vi.spyOn(adapter, "ensureAvailable").mockImplementation(
    () =>
      new Promise<string>((resolve) => {
        release = resolve
        entered()
      }),
  )
  const controller = new AbortController()
  const launching = adapter.launch({ ...input(), signal: controller.signal })
  const outcome = launching.catch((error: unknown) => error)
  await checking
  const cancelled = new Error("synthetic cancellation")
  controller.abort(cancelled)
  release(process.execPath)
  expect(await outcome).toBe(cancelled)
  expect(child.signals).toEqual([])
})

it("rechecks the service launch condition immediately before spawning", async () => {
  const { adapter, spawnCount } = await createAdapter()
  let release: (path: string) => void = () => undefined
  let entered: () => void = () => undefined
  const checking = new Promise<void>((resolve) => {
    entered = resolve
  })
  vi.spyOn(adapter, "ensureAvailable").mockImplementation(
    () =>
      new Promise<string>((resolve) => {
        release = resolve
        entered()
      }),
  )
  let allowed = true
  const blocked = new Error("synthetic pending cleanup")
  const launching = adapter.launch({
    ...input(),
    assertCanSpawn: () => {
      if (!allowed) throw blocked
    },
  })
  const result = launching.catch((error: unknown) => error)
  await checking
  allowed = false
  release(process.execPath)
  expect(await result).toBe(blocked)
  expect(spawnCount()).toBe(0)
})

it("reuses an in-flight stop while disposing instead of serially timing out twice", async () => {
  const { adapter, child } = await createAdapter()
  const launched = await adapter.launch(input())
  vi.useFakeTimers()
  const stopping = launched.stop().catch((error: unknown) => error)
  const disposing = adapter.dispose().catch((error: unknown) => error)
  await vi.advanceTimersByTimeAsync(1_100)
  expect(await stopping).toMatchObject({ code: "BROWSER_STOP_FAILED" })
  expect(await disposing).toMatchObject({ code: "BROWSER_STOP_FAILED" })
  expect(child.signals).toEqual(["SIGTERM", "SIGKILL"])
})

it("does not reuse a stale instance stop when disposal must stop a newer instance", async () => {
  const root = await mkdtemp(join(tmpdir(), "browser-lifecycle-"))
  roots.push(root)
  const children: FakeChild[] = []
  const fakeSpawn = (() => {
    const child = new FakeChild()
    child.exitOnTerm = true
    children.push(child)
    queueMicrotask(() => child.emit("spawn"))
    return child as unknown as ChildProcess
  }) as typeof spawn
  const adapter = new FingerprintChromiumAdapter({
    binaryPath: process.execPath,
    profilesRoot: root,
    spawn: fakeSpawn,
  })
  const first = await adapter.launch(input())
  await adapter.launch(input())
  const staleStop = first.stop()
  const disposing = adapter.dispose()
  await Promise.all([staleStop, disposing])
  expect(children[0]?.signals).toEqual(["SIGTERM"])
  expect(children[1]?.signals).toEqual(["SIGTERM"])
})

it("keeps the current in-flight stop even when an older handle queues a stop", async () => {
  const root = await mkdtemp(join(tmpdir(), "browser-lifecycle-"))
  roots.push(root)
  const children: FakeChild[] = []
  const fakeSpawn = (() => {
    const child = new FakeChild()
    child.exitOnTerm = children.length === 0
    children.push(child)
    queueMicrotask(() => child.emit("spawn"))
    return child as unknown as ChildProcess
  }) as typeof spawn
  const adapter = new FingerprintChromiumAdapter({
    binaryPath: process.execPath,
    profilesRoot: root,
    spawn: fakeSpawn,
    stopTimeoutMs: 5,
  })
  const first = await adapter.launch(input())
  const second = await adapter.launch(input())
  vi.useFakeTimers()
  const stopping = second.stop().catch((error: unknown) => error)
  const stale = first.stop()
  const disposing = adapter.dispose().catch((error: unknown) => error)
  await vi.advanceTimersByTimeAsync(1_100)
  expect(await stopping).toMatchObject({ code: "BROWSER_STOP_FAILED" })
  expect(await disposing).toMatchObject({ code: "BROWSER_STOP_FAILED" })
  await stale
  expect(children[1]?.signals).toEqual(["SIGTERM", "SIGKILL"])
})

it("waits for an already queued profile deletion while disposing", async () => {
  const { adapter, child } = await createAdapter()
  const launched = await adapter.launch(input())
  const stopping = launched.stop()
  const deleting = adapter.deleteProfile("account")
  let deleted = false
  void deleting.then(() => {
    deleted = true
  })
  const disposing = adapter.dispose()
  await Promise.resolve()
  child.finish("SIGTERM")
  await stopping
  await disposing
  expect(deleted).toBe(true)
  await deleting
})

it("waits for every process to settle before reporting a stop-all failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "browser-lifecycle-"))
  roots.push(root)
  const children: FakeChild[] = []
  const fakeSpawn = (() => {
    const child = new FakeChild()
    children.push(child)
    queueMicrotask(() => child.emit("spawn"))
    return child as unknown as ChildProcess
  }) as typeof spawn
  const adapter = new FingerprintChromiumAdapter({
    binaryPath: process.execPath,
    profilesRoot: root,
    spawn: fakeSpawn,
  })
  await adapter.launch(input())
  await adapter.launch({ ...input(), accountId: "other" })
  const first = children[0]
  const second = children[1]
  if (!first || !second) throw new Error("expected two child fixtures")
  first.throwOnTerm = true
  const stopping = adapter.stopAll()
  let finished = false
  const outcome = stopping.then(
    () => ({ status: "resolved" }),
    (error: unknown) => ({ status: "rejected", error }),
  )
  void outcome.then(() => {
    finished = true
  })
  await Promise.resolve()
  await Promise.resolve()
  expect(finished).toBe(false)
  expect(second.signals).toEqual(["SIGTERM"])
  second.finish("SIGTERM")
  expect(await outcome).toMatchObject({
    status: "rejected",
    error: { code: "BROWSER_STOP_FAILED" },
  })
})

function input() {
  return {
    accountId: "account",
    authorizeUrl: "https://example.test/authorize",
    network: { mode: "system" as const },
    fingerprint,
  }
}

class FakeChild extends EventEmitter {
  pid = 4321
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null
  readonly signals: NodeJS.Signals[] = []
  exitOnTerm = false
  throwOnTerm = false
  unref(): void {}

  kill(signal: NodeJS.Signals): boolean {
    this.signals.push(signal)
    if (signal === "SIGTERM" && this.throwOnTerm) throw new Error("synthetic stop failure")
    if (signal === "SIGTERM" && this.exitOnTerm) this.finish(signal)
    return true
  }

  finish(signal: NodeJS.Signals | null): void {
    this.exitCode = signal === null ? 0 : null
    this.signalCode = signal
    this.emit("exit", this.exitCode, signal)
  }
}

async function createAdapter(exitImmediately = false) {
  const root = await mkdtemp(join(tmpdir(), "browser-lifecycle-"))
  roots.push(root)
  const child = new FakeChild()
  let count = 0
  const fakeSpawn = (() => {
    count++
    queueMicrotask(() => {
      child.emit("spawn")
      if (exitImmediately) child.finish(null)
    })
    return child as unknown as ChildProcess
  }) as typeof spawn
  return {
    adapter: new FingerprintChromiumAdapter({
      binaryPath: process.execPath,
      profilesRoot: root,
      spawn: fakeSpawn,
      stopTimeoutMs: 5,
    }),
    child,
    root,
    spawnCount: () => count,
  }
}
