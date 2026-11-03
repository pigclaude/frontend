// 验证 Xray 退出标记早于守护进程关闭时，就绪检查会等待同端口恢复。

import type { ChildProcess, spawn } from "node:child_process"
import { EventEmitter } from "node:events"
import { createServer } from "node:net"
import { PassThrough } from "node:stream"
import { expect, it } from "vitest"
import { createXrayRuntimeStarter } from "./xray-runtime"

it("收到 Xray 退出标记后立即视为不可用，并等待守护进程关闭及恢复", async () => {
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
    idleTimeoutMs: 0,
  })
  let runtime: Awaited<ReturnType<typeof start>> | undefined
  try {
    runtime = await start({ upstreamProxyUrl: "http://127.0.0.1:9" })
    const first = watchdogs[0]
    if (first === undefined || runtime.ready === undefined) throw new Error("合成守护进程未启动")
    first.stdout.write("XRAY_EXITED\n")
    expect(() => runtime?.assertRunning?.()).toThrow()
    let ready = false
    const waiting = runtime.ready().then(() => {
      ready = true
    })
    await Promise.resolve()
    expect(ready).toBe(false)
    first.finish(1)
    await waiting
    expect(watchdogs).toHaveLength(2)
    expect(ready).toBe(true)
    expect(() => runtime?.assertRunning?.()).not.toThrow()
  } finally {
    for (const watchdog of watchdogs) {
      if (watchdog.exitCode === null) watchdog.finish(0)
    }
    await Promise.allSettled([runtime?.close(), start.dispose()])
  }
})

it("守护进程退出后原端口仍占用时，报告失败且不重启", async () => {
  const occupied = createServer()
  await new Promise<void>((resolve, reject) => {
    occupied.once("error", reject)
    occupied.listen(0, "127.0.0.1", resolve)
  })
  const address = occupied.address()
  if (address === null || typeof address === "string") throw new Error("测试端口未监听")
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
    allocatePort: async () => address.port,
    idleTimeoutMs: 0,
  })
  let runtime: Awaited<ReturnType<typeof start>> | undefined
  try {
    runtime = await start({ upstreamProxyUrl: "http://127.0.0.1:9" })
    if (runtime.failure === undefined || watchdogs[0] === undefined) throw new Error("测试未就绪")
    watchdogs[0].finish(1)
    await expect(runtime.failure).resolves.toMatchObject({ code: "PROXY_UNAVAILABLE" })
    expect(watchdogs).toHaveLength(1)
  } finally {
    await new Promise<void>((resolve) => occupied.close(() => resolve()))
    await Promise.allSettled([runtime?.close(), start.dispose()])
  }
}, 8_000)

it.skipIf(process.platform !== "win32")(
  "启动前守护进程异常退出且清理未确认时，不重启同一代理",
  async () => {
    const watchdogs: FakeWatchdog[] = []
    const fakeSpawn = (() => {
      const child = new FakeWatchdog(false)
      watchdogs.push(child)
      return child as unknown as ChildProcess
    }) as typeof spawn
    const start = createXrayRuntimeStarter({
      binaryPath: process.execPath,
      hostArch: process.arch,
      spawn: fakeSpawn,
      idleTimeoutMs: 0,
    })
    const input = { upstreamProxyUrl: "http://127.0.0.1:9" }
    await expect(start(input)).rejects.toMatchObject({ code: "PROXY_UNAVAILABLE" })
    await expect(start(input)).rejects.toMatchObject({ code: "PROXY_UNAVAILABLE" })
    expect(watchdogs).toHaveLength(1)
    await expect(start.dispose()).rejects.toMatchObject({ code: "PROXY_UNAVAILABLE" })
  },
)

class FakeWatchdog extends EventEmitter {
  readonly pid = 1
  readonly stdin = new PassThrough()
  readonly stdout = new PassThrough()
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null

  constructor(readyOnConfig = true) {
    super()
    this.stdin.once("data", () => {
      if (readyOnConfig) this.stdout.write("XRAY_READY\n")
      else this.finish(1)
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
