// 验证 Windows 守护进程被强制结束时，本次 Xray 进程能够退出。

import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process"
import { copyFile, mkdtemp, rm } from "node:fs/promises"
import { connect } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it } from "vitest"
import { findTestXrayProcess, stopTestXray, testProcessExists } from "./xray-process-test-utils"
import { createXrayRuntimeStarter } from "./xray-runtime"

const binary = process.env["PIGCLAUDE_TEST_XRAY_BIN"]

it.skipIf(process.platform !== "win32" || !binary)(
  "强制结束守护进程后，原 Xray 退出并在原端口恢复",
  async () => {
    if (!binary) throw new Error("缺少测试用 Xray")
    const directory = await mkdtemp(join(tmpdir(), "pigclaude-xray-win-crash-"))
    const testBinary = join(directory, "xray.exe")
    await copyFile(binary, testBinary)
    const watchdogs: ChildProcess[] = []
    const capture = ((command: string, args: string[], options: SpawnOptions) => {
      const child = spawn(command, args, options)
      watchdogs.push(child)
      return child
    }) as typeof spawn
    const start = createXrayRuntimeStarter({
      binaryPath: testBinary,
      hostArch: process.arch,
      idleTimeoutMs: 0,
      spawn: capture,
    })
    let runtime: Awaited<ReturnType<typeof start>> | undefined
    let xrayPid: number | undefined
    try {
      runtime = await start({ upstreamProxyUrl: "http://127.0.0.1:9" })
      const initialUrl = runtime.url
      const watchdog = watchdogs[0]
      if (watchdog?.pid === undefined) throw new Error("测试守护进程未启动")
      xrayPid = findTestXrayProcess(watchdog.pid, testBinary)
      expect(testProcessExists(xrayPid)).toBe(true)
      if (!watchdog.kill("SIGKILL")) throw new Error("未能结束测试守护进程")
      await expect.poll(() => testProcessExists(xrayPid!), { timeout: 6_000 }).toBe(false)
      await expect.poll(() => watchdogs.length, { timeout: 8_000 }).toBeGreaterThan(1)
      if (runtime.ready === undefined) throw new Error("缺少恢复就绪检查")
      await runtime.ready()
      expect(runtime.url).toBe(initialUrl)
      expect(await portOpen(initialUrl)).toBe(true)
      await expect(runtime.close()).resolves.toBeUndefined()
    } finally {
      await runtime?.close().catch(() => undefined)
      if (xrayPid !== undefined) stopTestXray(xrayPid, testBinary)
      await start.dispose().catch(() => undefined)
      await rm(directory, { recursive: true, force: true })
    }
  },
  25_000,
)

async function portOpen(value: string): Promise<boolean> {
  const url = new URL(value)
  return new Promise((resolve) => {
    const socket = connect(Number(url.port), url.hostname)
    socket.once("connect", () => {
      socket.destroy()
      resolve(true)
    })
    socket.once("error", () => resolve(false))
  })
}
