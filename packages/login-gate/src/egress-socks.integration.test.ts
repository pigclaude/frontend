// 验证 SOCKS5 入口无响应时出口核对超时，不连接上游代理或目标。

import { spawn } from "node:child_process"
import { createServer, type Server, type Socket } from "node:net"
import { resolve } from "node:path"
import { expect, it, vi } from "vitest"
import { checkEgress } from "./egress-check"

const [nodeMajor = 0, nodeMinor = 0] = process.versions.node.split(".").map(Number)

it("拒绝本地 data 地址，不能在未经过代理时报告出口一致", async () => {
  let connections = 0
  const bridge = createServer((socket) => {
    connections += 1
    socket.destroy()
  })
  const upstream = createServer((socket) => {
    connections += 1
    socket.destroy()
  })
  try {
    const bridgePort = await listen(bridge)
    const upstreamPort = await listen(upstream)
    const result = await checkEgress({
      bridgeUrl: `socks5://127.0.0.1:${bridgePort}`,
      upstreamProxyUrl: `http://127.0.0.1:${upstreamPort}`,
      checkUrl: "data:text/plain,ip%3D198.51.100.42",
      timeoutMs: 500,
    })
    expect(result).toMatchObject({ ok: false, reason: "proxy" })
    expect(connections).toBe(0)
  } finally {
    await Promise.all([close(bridge), close(upstream)])
  }
})

it("SOCKS5 无响应时结束核对且不尝试上游或直连", async () => {
  const sockets = new Set<Socket>()
  let greeting: Buffer | undefined
  let upstreamConnections = 0
  let targetConnections = 0
  const bridge = createServer((socket) => {
    sockets.add(socket)
    socket.once("close", () => sockets.delete(socket))
    socket.once("data", (chunk: Buffer) => {
      greeting = Buffer.from(chunk)
    })
    socket.resume()
  })
  const upstream = createServer((socket) => {
    upstreamConnections += 1
    socket.destroy()
  })
  const target = createServer((socket) => {
    targetConnections += 1
    socket.destroy()
  })
  const deadline = new AbortController()
  const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockReturnValueOnce(deadline.signal)
  try {
    const bridgePort = await listen(bridge)
    const upstreamPort = await listen(upstream)
    const targetPort = await listen(target)
    const check = checkEgress({
      bridgeUrl: `socks5://127.0.0.1:${bridgePort}`,
      upstreamProxyUrl: `http://127.0.0.1:${upstreamPort}`,
      checkUrl: `http://127.0.0.1:${targetPort}/trace`,
      timeoutMs: 250,
    })
    await expect.poll(() => greeting?.[0], { timeout: 2_000 }).toBe(5)
    deadline.abort(new DOMException("The operation was aborted due to timeout", "TimeoutError"))
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await expect(
        Promise.race([
          check,
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error("出口核对未及时结束")), 3_000)
          }),
        ]),
      ).resolves.toMatchObject({ ok: false, reason: "timeout" })
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
    expect(timeoutSpy).toHaveBeenCalledWith(250)
    expect(upstreamConnections).toBe(0)
    expect(targetConnections).toBe(0)
    await expect.poll(() => sockets.size, { timeout: 1_000 }).toBe(0)
  } finally {
    deadline.abort()
    timeoutSpy.mockRestore()
    for (const socket of sockets) socket.destroy()
    await Promise.all([close(bridge), close(upstream), close(target)])
  }
}, 10_000)

it("取消出口核对时立即关闭尚未完成的 SOCKS 连接", async () => {
  const sockets = new Set<Socket>()
  let observe: () => void = () => undefined
  const started = new Promise<void>((resolve) => {
    observe = resolve
  })
  const bridge = createServer((socket) => {
    sockets.add(socket)
    socket.once("close", () => sockets.delete(socket))
    socket.on("error", () => undefined)
    socket.once("data", () => observe())
  })
  const controller = new AbortController()
  let pending: Promise<unknown> | undefined
  try {
    const port = await listen(bridge)
    pending = checkEgress({
      bridgeUrl: `socks5://127.0.0.1:${port}`,
      upstreamProxyUrl: "http://127.0.0.1:9",
      checkUrl: "http://synthetic.example.invalid/",
      timeoutMs: 10_000,
      signal: controller.signal,
    }).catch((error: unknown) => error)
    await started
    controller.abort(new Error("合成取消"))
    const result = await Promise.race([
      pending,
      new Promise((resolve) => setTimeout(() => resolve("timeout"), 500)),
    ])
    expect(result).toMatchObject({ message: "合成取消" })
    await expect.poll(() => sockets.size, { timeout: 1_000 }).toBe(0)
  } finally {
    for (const socket of sockets) socket.destroy()
    await pending
    await close(bridge)
  }
})

it("IPv6 字面量通过 SOCKS5 以 IPv6 地址编码，不直接连接目标", async (context) => {
  let addressType: number | undefined
  let targetConnections = 0
  const target = createServer((socket) => {
    targetConnections += 1
    socket.destroy()
  })
  let targetPort: number
  try {
    targetPort = await listen(target, "::1")
  } catch {
    context.skip()
    return
  }
  const bridge = createServer((socket) => {
    let data = Buffer.alloc(0)
    let phase = 0
    socket.on("data", (chunk: Buffer) => {
      data = Buffer.concat([data, chunk])
      if (phase === 0 && data.length >= 2 && data.length >= 2 + (data[1] ?? 0)) {
        data = data.subarray(2 + (data[1] ?? 0))
        phase = 1
        socket.write(Buffer.from([5, 0]))
      }
      if (phase === 1 && data.length >= 4) {
        addressType = data[3]
        phase = 2
        socket.end(Buffer.from([5, 5, 0, 1, 0, 0, 0, 0, 0, 0]))
      }
    })
  })
  const upstream = createServer((socket) => socket.destroy())
  try {
    const bridgePort = await listen(bridge)
    const upstreamPort = await listen(upstream)
    const result = await checkEgress({
      bridgeUrl: `socks5://127.0.0.1:${bridgePort}`,
      upstreamProxyUrl: `http://127.0.0.1:${upstreamPort}`,
      checkUrl: `http://[::1]:${targetPort}/trace`,
      timeoutMs: 1_000,
    })
    expect(result).toMatchObject({ ok: false, reason: "proxy" })
    expect(addressType).toBe(4)
    expect(targetConnections).toBe(0)
  } finally {
    await Promise.all([close(bridge), close(upstream), close(target)])
  }
})

it.skipIf(nodeMajor < 22 || (nodeMajor === 22 && nodeMinor < 18))(
  "SOCKS5 握手后断开不会留下阻止进程退出的计时器",
  async () => {
    const fixture = resolve(import.meta.dirname, "egress-socks-exit-fixture.mjs")
    const child = spawn(process.execPath, [fixture], { stdio: ["ignore", "pipe", "pipe"] })
    let output = ""
    let errors = ""
    let timedOut = false
    let reported = false
    const killAsTimedOut = () => {
      timedOut = true
      child.kill("SIGKILL")
    }
    let timer = setTimeout(killAsTimedOut, 10_000)
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8")
      if (reported || !output.includes("\n")) return
      reported = true
      clearTimeout(timer)
      timer = setTimeout(killAsTimedOut, 3_000)
    })
    child.stderr.on("data", (chunk: Buffer) => {
      errors += chunk.toString("utf8")
    })
    try {
      const code = await new Promise<number | null>((resolve, reject) => {
        child.once("error", reject)
        child.once("exit", resolve)
      })
      expect(timedOut).toBe(false)
      expect(code, errors).toBe(0)
      expect(JSON.parse(output)).toEqual({
        ok: false,
        reason: "proxy",
        upstreamConnections: 0,
        targetConnections: 0,
      })
    } finally {
      clearTimeout(timer)
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
    }
  },
  15_000,
)

async function listen(server: Server, host = "127.0.0.1"): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, host, resolve)
  })
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("合成服务未监听")
  return address.port
}

async function close(server: Server): Promise<void> {
  if (!server.listening) return
  await new Promise<void>((resolve) => server.close(() => resolve()))
}
