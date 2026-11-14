// 验证安装包里的 Electron 关掉了主进程的 Node 调试入口：读取 fuses，并对照开发版 Electron 逐个尝试调试入口。
// 只在 PIGCLAUDE_TEST_PACKAGED_APP 指向安装包里的可执行文件时运行；会打开应用窗口。

import { FuseV1Options, getCurrentFuseWire } from "@electron/fuses"
import { spawn, type ChildProcess } from "node:child_process"
import { readdirSync } from "node:fs"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { connect, createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const packaged = process.env["PIGCLAUDE_TEST_PACKAGED_APP"]
const defaultInspectorPort = 9229
const entries = ["调试信号", "--inspect 参数", "NODE_OPTIONS"] as const
type DebugEntry = (typeof entries)[number]

describe.skipIf(!packaged)("安装包的主进程调试入口", () => {
  let controlApp = ""

  beforeAll(async () => {
    controlApp = await mkdtemp(join(tmpdir(), "pigclaude-debug-control-"))
    await writeFile(join(controlApp, "package.json"), '{"name":"debug-control","main":"main.js"}')
    await writeFile(
      join(controlApp, "main.js"),
      [
        'const { app } = require("electron")',
        "app.dock?.hide()",
        'app.whenReady().then(() => console.log("CONTROL_READY"))',
        "setInterval(() => {}, 1000)",
      ].join("\n"),
    )
  })

  afterAll(async () => {
    if (controlApp) await rm(controlApp, { recursive: true, force: true })
  })

  it("fuses 关掉 NODE_OPTIONS 和调试参数，RunAsNode 仍留给 Xray 守护程序", async () => {
    const wire = await getCurrentFuseWire(packaged!)
    expect({
      runAsNode: fuseEnabled(wire[FuseV1Options.RunAsNode]),
      nodeOptions: fuseEnabled(wire[FuseV1Options.EnableNodeOptionsEnvironmentVariable]),
      inspect: fuseEnabled(wire[FuseV1Options.EnableNodeCliInspectArguments]),
    }).toEqual({ runAsNode: true, nodeOptions: false, inspect: false })
  })

  it.each(entries)(
    "对照：开发版 Electron 经%s打开调试器",
    async (entry) => {
      const electron: unknown = createRequire(import.meta.url)("electron")
      if (typeof electron !== "string") throw new Error("找不到 Electron 可执行文件")
      expect(await probe(entry, electron, [controlApp])).toBe(true)
    },
    60_000,
  )

  it.each(entries)(
    "安装包的主进程经%s打不开调试器",
    async (entry) => {
      expect(await probe(entry, packaged!, [])).toBe(false)
    },
    60_000,
  )
})

/** fuse 线上每个字节是 ASCII 的 "1"（开）或 "0"（关）；其他值说明 fuse 已被移除或没有设置。 */
function fuseEnabled(state: number | undefined): boolean | null {
  if (state === "1".charCodeAt(0)) return true
  if (state === "0".charCodeAt(0)) return false
  return null
}

/** 启动后经指定入口尝试打开调试器；返回调试器是否打开。 */
async function probe(entry: DebugEntry, command: string, args: string[]): Promise<boolean> {
  const userData = await mkdtemp(join(tmpdir(), "pigclaude-debug-entry-"))
  const port = await freePort()
  const defaultPortTaken = await portOpen(defaultInspectorPort)
  const inspect = `--inspect=127.0.0.1:${port}`
  const child = spawn(command, [...(entry === "--inspect 参数" ? [inspect] : []), ...args], {
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PIGCLAUDE_USER_DATA: userData,
      ...(entry === "NODE_OPTIONS" ? { NODE_OPTIONS: inspect } : { NODE_OPTIONS: "" }),
    },
  })
  let output = ""
  child.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")))
  child.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")))
  try {
    const ready = await waitUntil(30_000, () => {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error("应用启动后退出")
      return args.length > 0 ? output.includes("CONTROL_READY") : readdirSync(userData).length > 0
    })
    if (!ready) throw new Error("应用没有在 30 秒内启动")
    if (entry === "调试信号") sendDebugSignal(child)
    if (await waitUntil(4_000, () => output.includes("Debugger listening"))) return true
    if (await portOpen(port)) return true
    return !defaultPortTaken && (await portOpen(defaultInspectorPort))
  } finally {
    await stop(child)
    await rm(userData, { recursive: true, force: true })
  }
}

/** 每 100ms 检查一次条件，直到成立或超时；返回条件是否成立。 */
async function waitUntil(timeoutMs: number, condition: () => boolean): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (condition()) return true
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return condition()
}

/** macOS 和 Linux 发 SIGUSR1；Windows 没有信号，用 Node 的远程调试请求，目标没注册调试处理时会报错。 */
function sendDebugSignal(child: ChildProcess): void {
  if (child.pid === undefined) throw new Error("应用进程没有 pid")
  if (process.platform !== "win32") {
    process.kill(child.pid, "SIGUSR1")
    return
  }
  const debugProcess: unknown = Reflect.get(process, "_debugProcess")
  if (typeof debugProcess !== "function") throw new Error("当前 Node 不支持远程调试请求")
  try {
    debugProcess.call(process, child.pid)
  } catch {
    return
  }
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => resolve())
    setTimeout(resolve, 10_000).unref()
  })
  if (process.platform === "win32") {
    spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" })
  } else {
    try {
      process.kill(-child.pid, "SIGKILL")
    } catch {
      child.kill("SIGKILL")
    }
  }
  await exited
}

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  if (address === null || typeof address === "string") throw new Error("无法分配测试端口")
  return address.port
}

async function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(port, "127.0.0.1", () => {
      socket.destroy()
      resolve(true)
    })
    socket.once("error", () => resolve(false))
  })
}
