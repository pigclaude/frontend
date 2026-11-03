// 验证端口检查遇到连接重置时，Xray 会等待端口释放再恢复。

import type { ChildProcess, spawn } from "node:child_process"
import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"
import { beforeEach, expect, it, vi } from "vitest"
import { createXrayRuntimeStarter } from "./xray-runtime"

const probe = vi.hoisted(() => ({ port: 31_337, attempts: 0 }))

vi.mock("node:net", async (loadOriginal) => {
  const actual = await loadOriginal<typeof import("node:net")>()
  const { EventEmitter: Emitter } = await import("node:events")
  return {
    ...actual,
    connect: (port: number, host: string) => {
      if (port !== probe.port) return actual.connect(port, host)
      probe.attempts += 1
      const socket = new Emitter()
      Object.assign(socket, { setTimeout: () => socket, destroy: () => socket })
      queueMicrotask(() => {
        const code = probe.attempts === 1 ? "ECONNRESET" : "ECONNREFUSED"
        socket.emit("error", Object.assign(new Error("合成端口状态"), { code }))
      })
      return socket
    },
  }
})

beforeEach(() => {
  probe.attempts = 0
})

it("端口检查暂时被重置时，等待释放并按原端口恢复", async () => {
  const watchdogs: FakeWatchdog[] = []
  const fakeSpawn = (() => {
    const child = new FakeWatchdog()
    watchdogs.push(child)
    return child as unknown as ChildProcess
  }) as typeof spawn
  const start = createXrayRuntimeStarter({
    binaryPath: process.execPath,
    hostArch: process.arch,
    spawn: fakeSpawn,
    allocatePort: async () => probe.port,
    idleTimeoutMs: 0,
  })
  let runtime: Awaited<ReturnType<typeof start>> | undefined
  try {
    runtime = await start({ upstreamProxyUrl: "http://127.0.0.1:9" })
    const initialUrl = runtime.url
    if (watchdogs[0] === undefined) throw new Error("测试守护进程未启动")
    watchdogs[0].finish(1)
    await expect.poll(() => watchdogs.length, { timeout: 1_000 }).toBe(2)
    if (runtime.ready === undefined) throw new Error("缺少恢复就绪检查")
    await runtime.ready()
    expect(runtime.url).toBe(initialUrl)
    expect(probe.attempts).toBeGreaterThanOrEqual(2)
  } finally {
    await Promise.allSettled([runtime?.close(), start.dispose()])
  }
})

it("首次启动失败时端口状态不明，不将其误判为端口占用", async () => {
  const watchdogs: FakeWatchdog[] = []
  const fakeSpawn = (() => {
    const child = new FakeWatchdog(true)
    watchdogs.push(child)
    return child as unknown as ChildProcess
  }) as typeof spawn
  const start = createXrayRuntimeStarter({
    binaryPath: process.execPath,
    hostArch: process.arch,
    spawn: fakeSpawn,
    allocatePort: async () => probe.port,
    idleTimeoutMs: 0,
  })
  try {
    await expect(start({ upstreamProxyUrl: "http://127.0.0.1:9" })).rejects.toMatchObject({
      code: "PROXY_UNAVAILABLE",
    })
    expect(watchdogs).toHaveLength(1)
    expect(probe.attempts).toBe(1)
  } finally {
    await start.dispose()
  }
})

class FakeWatchdog extends EventEmitter {
  readonly pid = 1
  readonly stdin = new PassThrough()
  readonly stdout = new PassThrough()
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null

  constructor(exitBeforeReady = false) {
    super()
    this.stdin.once("data", () => {
      if (exitBeforeReady) {
        this.stdout.write("XRAY_EXITED\n")
        this.finish(1)
      } else {
        this.stdout.write("XRAY_READY\n")
      }
    })
    this.stdin.once("finish", () => this.finish(0))
  }

  finish(code: number): void {
    if (this.exitCode !== null) return
    this.exitCode = code
    this.emit("exit", code, null)
    this.stdout.end()
    this.emit("close", code, null)
  }

  kill(): boolean {
    this.finish(0)
    return true
  }
}
