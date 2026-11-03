// 验证安装包资源布局中的守护程序启动及结束后回收真实 Xray。

import { execFileSync, spawn, type ChildProcess } from "node:child_process"
import { copyFile, cp, mkdtemp, readFile, rm } from "node:fs/promises"
import { createRequire } from "node:module"
import { connect, createServer } from "node:net"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { expect, it } from "vitest"
import { findTestXrayProcess, stopTestXray, testProcessExists } from "./xray-process-test-utils"

const binary = process.env["PIGCLAUDE_TEST_XRAY_BIN"]
const enabled = process.env["PIGCLAUDE_TEST_BUILT_WATCHDOG"] === "1"
const desktop = resolve(import.meta.dirname, "../../..")

it.skipIf(!binary || !enabled).each(
  process.platform === "win32"
    ? ([
        ["正常关闭", false],
        ["强制结束", true],
      ] as const)
    : ([["正常关闭", false]] as const),
)(
  "安装包资源中的守护程序%s后回收真实 Xray",
  async (_label, forced) => {
    const directory = await mkdtemp(join(tmpdir(), "pigclaude-watchdog-package-"))
    const testBinary = forced ? join(directory, "xray.exe") : binary!
    let child: ChildProcess | undefined
    let xrayPid: number | undefined
    let exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }> | undefined
    let port: number | undefined
    try {
      if (forced) await copyFile(binary!, testBinary)
      const config: unknown = JSON.parse(
        await readFile(join(desktop, "electron-builder.json"), "utf8"),
      )
      if (!isRecord(config) || !Array.isArray(config.extraResources))
        throw new Error("安装资源配置无效")
      for (const name of ["xray-watchdog.cjs", "chunks"]) {
        const entry: unknown = config.extraResources.find(
          (item: unknown) => isRecord(item) && item.to === name,
        )
        if (!isRecord(entry) || typeof entry.from !== "string")
          throw new Error(`缺少安装资源 ${name}`)
        await cp(join(desktop, entry.from), join(directory, name), { recursive: true })
      }
      port = await reservePort()
      const electron: unknown = createRequire(import.meta.url)("electron")
      if (typeof electron !== "string") throw new Error("找不到 Electron 可执行文件")
      const spawned = spawn(electron, [join(directory, "xray-watchdog.cjs"), testBinary], {
        detached: process.platform !== "win32",
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      })
      child = spawned
      exited = new Promise((resolve) => {
        spawned.once("close", (code, signal) => resolve({ code, signal }))
        spawned.once("error", () => resolve({ code: null, signal: null }))
      })
      spawned.stdin?.on("error", () => undefined)
      spawned.stderr?.resume()
      const ready = waitForReady(spawned)
      spawned.stdin?.write(
        `${JSON.stringify({
          log: { loglevel: "warning" },
          inbounds: [{ listen: "127.0.0.1", port, protocol: "socks", settings: { udp: true } }],
          outbounds: [
            { protocol: "http", settings: { servers: [{ address: "127.0.0.1", port: 9 }] } },
          ],
        })}\n`,
      )
      await ready
      if (process.platform === "win32") {
        if (spawned.pid === undefined) throw new Error("守护程序身份未知")
        xrayPid = findTestXrayProcess(spawned.pid, testBinary)
      }
      expect(await socksGreeting(port)).toEqual([5, 0])
      if (forced) {
        if (!spawned.kill("SIGKILL")) throw new Error("无法结束测试守护程序")
        await within(exited, 5_000)
        if (xrayPid === undefined) throw new Error("Xray 进程身份未知")
        await expect.poll(() => testProcessExists(xrayPid!), { timeout: 6_000 }).toBe(false)
      } else {
        spawned.stdin?.end()
        expect(await within(exited, 5_000)).toEqual({ code: 0, signal: null })
      }
    } finally {
      if (child !== undefined && exited !== undefined) {
        child.stdin?.end()
        const closed = await within(
          exited.then(() => true),
          5_000,
        ).catch(() => false)
        if (!closed && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
        const processClosed =
          closed ||
          (await within(
            exited.then(() => true),
            5_000,
          ).catch(() => false))
        const resourcesClosed =
          child.pid === undefined || port === undefined
            ? processClosed
            : await waitForRelease(child.pid, port, xrayPid).catch(() => false)
        if (!processClosed || !resourcesClosed) {
          if (forced && xrayPid !== undefined) stopTestXray(xrayPid, testBinary)
          throw new Error(`守护程序或 Xray 未确认退出，保留临时目录 ${directory}`)
        }
      }
      await rm(directory, { recursive: true, force: true })
    }
  },
  30_000,
)

async function reservePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("无法分配测试端口")
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
  return address.port
}

async function waitForReady(child: ChildProcess): Promise<void> {
  const ready = new Promise<void>((resolve, reject) => {
    let output = ""
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8")
      if (output.includes("XRAY_READY\n")) resolve()
    })
    child.once("exit", () => reject(new Error("安装资源中的守护程序提前退出")))
    child.once("error", reject)
  })
  await within(ready, 5_000)
}

async function socksGreeting(port: number): Promise<number[]> {
  return new Promise<number[]>((resolve, reject) => {
    const socket = connect(port, "127.0.0.1", () => socket.write(Buffer.from([5, 1, 0])))
    let received = Buffer.alloc(0)
    socket.setTimeout(2_000, () => socket.destroy(new Error("SOCKS5 握手超时")))
    socket.on("data", (data) => {
      received = Buffer.concat([received, data])
      if (received.length >= 2) {
        socket.destroy()
        resolve([...received.subarray(0, 2)])
      }
    })
    socket.once("error", reject)
  })
}

async function waitForRelease(group: number, port: number, xrayPid?: number): Promise<boolean> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const processesStopped =
      process.platform === "win32"
        ? xrayPid !== undefined && !testProcessExists(xrayPid)
        : !groupExists(group)
    if (processesStopped && !(await portOpen(port))) return true
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return false
}

function groupExists(group: number): boolean {
  const processes = execFileSync("ps", ["-A", "-o", "pid=", "-o", "pgid="], {
    encoding: "utf8",
  })
  return processes.split(/\r?\n/).some((line) => {
    const fields = line.trim().split(/\s+/)
    return fields.length === 2 && Number(fields[1]) === group
  })
}

async function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1", () => {
      socket.destroy()
      resolve(true)
    })
    socket.setTimeout(1_000, () => socket.destroy(new Error("无法确认 SOCKS5 端口关闭")))
    socket.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ECONNREFUSED") resolve(false)
      else reject(error)
    })
  })
}

async function within<T>(task: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      task,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("安装资源验证超时")), timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
