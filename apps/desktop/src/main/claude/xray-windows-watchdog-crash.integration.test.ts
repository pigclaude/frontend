// 验证 Windows 守护进程被强制结束时，本次 Xray 进程能够退出。

import { execFileSync, spawn, type ChildProcess, type SpawnOptions } from "node:child_process"
import { copyFile, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it } from "vitest"
import { findTestXrayProcess } from "./xray-process-test-utils"
import { createXrayRuntimeStarter } from "./xray-runtime"

const binary = process.env["PIGCLAUDE_TEST_XRAY_BIN"]

it.skipIf(process.platform !== "win32" || !binary)(
  "强制结束守护进程后，原 Xray 进程退出",
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
      const watchdog = watchdogs[0]
      if (watchdog?.pid === undefined) throw new Error("测试守护进程未启动")
      xrayPid = findTestXrayProcess(watchdog.pid, testBinary)
      expect(processExists(xrayPid)).toBe(true)
      if (!watchdog.kill("SIGKILL")) throw new Error("未能结束测试守护进程")
      await expect.poll(() => processExists(xrayPid!), { timeout: 6_000 }).toBe(false)
    } finally {
      await runtime?.close().catch(() => undefined)
      if (xrayPid !== undefined) stopTestXray(xrayPid, testBinary)
      await start.dispose().catch(() => undefined)
      await rm(directory, { recursive: true, force: true })
    }
  },
  25_000,
)

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") return false
    throw error
  }
}

function stopTestXray(pid: number, binaryPath: string): void {
  if (!processExists(pid)) return
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$process = Get-Process -Id ${pid} -ErrorAction SilentlyContinue`,
    "if ($null -eq $process) { exit 0 }",
    "$handle = $process.Handle",
    "if ($process.MainModule.FileName -ne $env:PIGCLAUDE_TEST_XRAY_PATH) { throw '进程身份不匹配' }",
    "$process.Kill()",
    "if (!$process.WaitForExit(5000)) { throw '测试进程未退出' }",
    "$process.Dispose()",
  ].join("; ")
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    env: { ...process.env, PIGCLAUDE_TEST_XRAY_PATH: binaryPath },
    timeout: 10_000,
  })
}
