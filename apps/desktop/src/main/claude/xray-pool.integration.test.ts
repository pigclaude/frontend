// 验证相同代理配置复用 Xray，并在最后一个使用者释放后回收。

import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process"
import { createServer as createHttpServer } from "node:http"
import { connect, createServer } from "node:net"
import { createXrayHttpClient } from "@pigclaude/login-gate/xray-http"
import { expect, it } from "vitest"
import { findTestXrayProcess } from "./xray-process-test-utils"
import { createXrayRuntimeStarter } from "./xray-runtime"

const binary = process.env["PIGCLAUDE_TEST_XRAY_BIN"]

it.skipIf(!binary)(
  "相同代理复用 Xray，最后一个使用者释放后回收",
  async () => {
    const start = createXrayRuntimeStarter({
      binaryPath: binary,
      hostArch: process.arch,
      idleTimeoutMs: 50,
    })
    let first: Awaited<ReturnType<typeof start>> | undefined
    let second: Awaited<ReturnType<typeof start>> | undefined
    try {
      first = await start({ upstreamProxyUrl: "http://127.0.0.1:9" })
      second = await start({ upstreamProxyUrl: "HTTP://127.0.0.1:9/" })
      expect(first.url).toBe(second.url)
      await first.close()
      expect(await portOpen(first.url)).toBe(true)
      second.assertRunning?.()
      await second.close()
      await expect.poll(() => portOpen(first!.url), { timeout: 2_000 }).toBe(false)
    } finally {
      await start.dispose()
    }
  },
  10_000,
)

it.skipIf(!binary)(
  "Xray 意外退出后使用原端口和代理配置恢复",
  async () => {
    if (!binary) throw new Error("缺少测试用 Xray")
    const watchdogs: ChildProcess[] = []
    const capture = ((command: string, args: string[], options: SpawnOptions) => {
      const child = spawn(command, args, options)
      watchdogs.push(child)
      return child
    }) as typeof spawn
    const start = createXrayRuntimeStarter({
      binaryPath: binary,
      hostArch: process.arch,
      idleTimeoutMs: 50,
      spawn: capture,
    })
    let upstreamRequests = 0
    const upstream = createHttpServer()
    upstream.on("connect", (request, socket) => {
      const expected = `Basic ${Buffer.from("synthetic:password").toString("base64")}`
      if (request.headers["proxy-authorization"] !== expected) {
        socket.destroy()
        return
      }
      upstreamRequests += 1
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n")
      socket.once("data", () =>
        socket.end("HTTP/1.1 200 OK\r\nContent-Length: 9\r\nConnection: close\r\n\r\nsame-xray"),
      )
    })
    try {
      await new Promise<void>((resolve, reject) => {
        upstream.once("error", reject)
        upstream.listen(0, "127.0.0.1", resolve)
      })
      const address = upstream.address()
      if (address === null || typeof address === "string") throw new Error("上游夹具未监听")
      const upstreamProxyUrl = `http://synthetic:password@127.0.0.1:${address.port}`
      const runtime = await start({ upstreamProxyUrl })
      const otherUser = await start({ upstreamProxyUrl })
      const client = createXrayHttpClient(runtime.url)
      const request = () =>
        client.request("http://synthetic.example.invalid/", {
          method: "GET",
          headers: {},
          signal: AbortSignal.timeout(3_000),
        })
      expect(await (await request()).text()).toBe("same-xray")
      expect(otherUser.url).toBe(runtime.url)
      const initialUrl = runtime.url
      const watchdogPid = watchdogs[0]?.pid
      if (!watchdogPid) throw new Error("未找到本次守护进程")
      const xrayPid = findTestXrayProcess(watchdogPid, binary)
      process.kill(xrayPid, "SIGKILL")
      await expect
        .poll(
          async () => {
            try {
              if (watchdogs.length < 2) return false
              runtime.assertRunning?.()
              return await portOpen(runtime.url)
            } catch {
              return false
            }
          },
          { timeout: 8_000 },
        )
        .toBe(true)
      expect(runtime.url).toBe(initialUrl)
      expect(await (await request()).text()).toBe("same-xray")
      expect(upstreamRequests).toBe(2)
      client.close()
      await runtime.close()
      otherUser.assertRunning?.()
      expect(await portOpen(otherUser.url)).toBe(true)
      await otherUser.close()
    } finally {
      try {
        await start.dispose()
      } finally {
        upstream.closeAllConnections()
        if (upstream.listening)
          await new Promise<void>((resolve) => upstream.close(() => resolve()))
      }
    }
  },
  15_000,
)

it.skipIf(!binary)(
  "不同代理配置使用各自的 Xray 入口",
  async () => {
    const start = createXrayRuntimeStarter({
      binaryPath: binary,
      hostArch: process.arch,
      idleTimeoutMs: 50,
    })
    try {
      const first = await start({ upstreamProxyUrl: "http://127.0.0.1:9" })
      const second = await start({ upstreamProxyUrl: "http://127.0.0.1:10" })
      expect(first.url).not.toBe(second.url)
      await first.close()
      await expect.poll(() => portOpen(first.url), { timeout: 2_000 }).toBe(false)
      second.assertRunning?.()
      expect(await portOpen(second.url)).toBe(true)
      await second.close()
    } finally {
      await start.dispose()
    }
  },
  10_000,
)

it.skipIf(!binary)(
  "首次启动遇端口占用时，重新分配本机端口启动同一代理",
  async () => {
    const occupied = createServer()
    const available = createServer()
    await new Promise<void>((resolve, reject) => {
      occupied.once("error", reject)
      occupied.listen(0, "127.0.0.1", resolve)
    })
    try {
      await new Promise<void>((resolve, reject) => {
        available.once("error", reject)
        available.listen(0, "127.0.0.1", resolve)
      })
      const first = occupied.address()
      const second = available.address()
      if (
        first === null ||
        typeof first === "string" ||
        second === null ||
        typeof second === "string"
      )
        throw new Error("测试端口不可用")
      await new Promise<void>((resolve) => available.close(() => resolve()))
      let allocations = 0
      const start = createXrayRuntimeStarter({
        binaryPath: binary,
        hostArch: process.arch,
        idleTimeoutMs: 0,
        allocatePort: async () => {
          allocations += 1
          return allocations === 1 ? first.port : second.port
        },
      })
      try {
        const runtime = await start({ upstreamProxyUrl: "http://127.0.0.1:9" })
        expect(Number(new URL(runtime.url).port)).toBe(second.port)
        expect(allocations).toBe(2)
        await runtime.close()
      } finally {
        await start.dispose()
      }
    } finally {
      if (available.listening)
        await new Promise<void>((resolve) => available.close(() => resolve()))
      if (occupied.listening) await new Promise<void>((resolve) => occupied.close(() => resolve()))
    }
  },
  15_000,
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
