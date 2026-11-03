// 通过桌面代理服务和真实 Xray 验证合成上游代理的认证、出口及资源回收。

import { copyFile, link, mkdir, mkdtemp, rm } from "node:fs/promises"
import { createServer as createHttpServer } from "node:http"
import { connect, type Socket } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { LocalStore } from "@pigclaude/local-store"
import type { ProxyRuntime } from "@pigclaude/login-gate/proxy-runtime"
import { describe, expect, it } from "vitest"
import { ProxyService } from "./proxy-service"
import { createXrayRuntimeStarter } from "./xray-runtime"

const xrayBinary = process.env["PIGCLAUDE_TEST_XRAY_BIN"]

function allowSyntheticProbe(): void {}

it("启动失败且无法确认回收时保留失败状态", async () => {
  const start = createXrayRuntimeStarter({ binaryPath: process.execPath, hostArch: process.arch })
  await expect(start({ upstreamProxyUrl: "http://127.0.0.1:9" })).rejects.toMatchObject({
    code: "PROXY_UNAVAILABLE",
  })
  await new Promise((resolve) => setTimeout(resolve, 100))
  await expect(start.dispose()).rejects.toMatchObject({ code: "PROXY_UNAVAILABLE" })
})

describe.skipIf(!xrayBinary)("真实 Xray 桌面出口核对", () => {
  it("通过本机 Xray 与合成账密代理取得相同出口", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pigclaude-xray-egress-"))
    const fixture = await createProxyFixture()
    let runtime: ProxyRuntime | undefined
    try {
      const store = new LocalStore(directory)
      await store.saveProxy({
        schemaVersion: 1,
        id: "proxy",
        name: "合成代理",
        url: `http://user%40test:p%3Ass@127.0.0.1:${fixture.proxyPort}`,
        lastTest: null,
      })
      const service = new ProxyService({
        store,
        checkUrl: `http://127.0.0.1:${fixture.targetPort}/trace`,
        ensureBrowserProxyProtection: allowSyntheticProbe,
        startProxyRuntime: async (input) => {
          runtime = await createXrayRuntimeStarter({
            hostArch: process.arch,
            binaryPath: xrayBinary,
          })(input)
          return runtime
        },
      })

      await expect(service.checkEgress("proxy")).resolves.toEqual({
        ok: true,
        ip: "198.51.100.42",
      })
      expect(fixture.accepted()).toBe(2)
      expect(fixture.targetRequests()).toBe(2)
      expect(runtime).toBeDefined()
      await expect(portIsOpen(new URL(runtime!.url))).resolves.toBe(false)
    } finally {
      await fixture.close()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("错误账密无法访问目标且不会转为直连", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pigclaude-xray-egress-"))
    const fixture = await createProxyFixture()
    try {
      const store = new LocalStore(directory)
      await store.saveProxy({
        schemaVersion: 1,
        id: "proxy",
        name: "合成代理",
        url: `http://user%40test:wrong@127.0.0.1:${fixture.proxyPort}`,
        lastTest: null,
      })
      const service = new ProxyService({
        store,
        checkUrl: `http://127.0.0.1:${fixture.targetPort}/trace`,
        ensureBrowserProxyProtection: allowSyntheticProbe,
        startProxyRuntime: createXrayRuntimeStarter({
          hostArch: process.arch,
          binaryPath: xrayBinary,
        }),
      })

      await expect(service.checkEgress("proxy")).resolves.toMatchObject({
        ok: false,
        reason: "proxy",
      })
      expect(fixture.targetRequests()).toBe(0)
    } finally {
      await fixture.close()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it.each([
    ["name@", "name:"],
    [":secret@", ":secret"],
  ])("单字段账密 %s 与已有上游认证语义一致", async (credentials, decoded) => {
    const directory = await mkdtemp(join(tmpdir(), "pigclaude-xray-egress-"))
    const fixture = await createProxyFixture(decoded)
    try {
      const store = new LocalStore(directory)
      await store.saveProxy({
        schemaVersion: 1,
        id: "proxy",
        name: "合成代理",
        url: `http://${credentials}127.0.0.1:${fixture.proxyPort}`,
        lastTest: null,
      })
      const service = new ProxyService({
        store,
        checkUrl: `http://127.0.0.1:${fixture.targetPort}/trace`,
        ensureBrowserProxyProtection: allowSyntheticProbe,
        startProxyRuntime: createXrayRuntimeStarter({
          hostArch: process.arch,
          binaryPath: xrayBinary,
        }),
      })
      await expect(service.checkEgress("proxy")).resolves.toEqual({
        ok: true,
        ip: "198.51.100.42",
      })
      expect(fixture.targetRequests()).toBe(2)
    } finally {
      await fixture.close()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it.each(["upstream", "xray"] as const)("%s 中断时出口核对失败且不访问目标", async (failure) => {
    const directory = await mkdtemp(join(tmpdir(), "pigclaude-xray-egress-"))
    const fixture = await createProxyFixture()
    try {
      const store = new LocalStore(directory)
      await store.saveProxy({
        schemaVersion: 1,
        id: "proxy",
        name: "合成代理",
        url: `http://user%40test:p%3Ass@127.0.0.1:${fixture.proxyPort}`,
        lastTest: null,
      })
      const start = createXrayRuntimeStarter({ hostArch: process.arch, binaryPath: xrayBinary })
      const service = new ProxyService({
        store,
        checkUrl: `http://127.0.0.1:${fixture.targetPort}/trace`,
        ensureBrowserProxyProtection: allowSyntheticProbe,
        startProxyRuntime: async (input) => {
          const runtime = await start(input)
          if (failure === "upstream") fixture.failProxy()
          else await start.dispose()
          return runtime
        },
      })
      const result = service.checkEgress("proxy")
      if (failure === "xray") {
        await expect(result).rejects.toMatchObject({ code: "PROXY_UNAVAILABLE" })
      } else {
        await expect(result).resolves.toMatchObject({ ok: false })
      }
      expect(fixture.targetRequests()).toBe(0)
    } finally {
      await fixture.close()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("出口核对期间 Xray 退出时不会报告成功", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pigclaude-xray-egress-"))
    const fixture = await createProxyFixture()
    try {
      const store = new LocalStore(directory)
      await store.saveProxy({
        schemaVersion: 1,
        id: "proxy",
        name: "合成代理",
        url: `http://user%40test:p%3Ass@127.0.0.1:${fixture.proxyPort}`,
        lastTest: null,
      })
      const start = createXrayRuntimeStarter({ hostArch: process.arch, binaryPath: xrayBinary })
      const service = new ProxyService({
        store,
        checkUrl: `http://127.0.0.1:${fixture.targetPort}/trace`,
        ensureBrowserProxyProtection: allowSyntheticProbe,
        startProxyRuntime: async (input) => {
          const runtime = await start(input)
          fixture.onTarget(async (count) => {
            if (count === 2) await runtime.close()
          })
          return runtime
        },
      })
      await expect(service.checkEgress("proxy")).rejects.toMatchObject({
        code: "PROXY_UNAVAILABLE",
      })
    } finally {
      await fixture.close()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("Xray 文件缺失时及时返回稳定错误且不访问目标", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pigclaude-xray-egress-"))
    const fixture = await createProxyFixture()
    try {
      const store = new LocalStore(directory)
      await store.saveProxy({
        schemaVersion: 1,
        id: "proxy",
        name: "合成代理",
        url: `http://user%40test:p%3Ass@127.0.0.1:${fixture.proxyPort}`,
        lastTest: null,
      })
      const service = new ProxyService({
        store,
        checkUrl: `http://127.0.0.1:${fixture.targetPort}/trace`,
        ensureBrowserProxyProtection: allowSyntheticProbe,
        startProxyRuntime: createXrayRuntimeStarter({
          hostArch: process.arch,
          binaryPath: join(directory, "missing"),
        }),
      })

      await expect(service.checkEgress("proxy")).rejects.toMatchObject({
        code: "PROXY_UNAVAILABLE",
      })
      expect(fixture.targetRequests()).toBe(0)
    } finally {
      await fixture.close()
      await rm(directory, { recursive: true, force: true })
    }
  }, 2_000)

  it("从当前系统和架构的资源目录启动真实 Xray", async () => {
    if (!xrayBinary) throw new Error("缺少测试用 Xray")
    const directory = await mkdtemp(join(tmpdir(), "pigclaude-xray-egress-"))
    const fixture = await createProxyFixture()
    try {
      const assetDirectory = join(
        directory,
        "pigclaude-runtime",
        "xray",
        `${process.platform}-${process.arch}`,
      )
      await mkdir(assetDirectory, { recursive: true })
      const asset = join(assetDirectory, process.platform === "win32" ? "xray.exe" : "xray")
      await link(xrayBinary, asset).catch(() => copyFile(xrayBinary, asset))
      const store = new LocalStore(join(directory, "store"))
      await store.saveProxy({
        schemaVersion: 1,
        id: "proxy",
        name: "合成代理",
        url: `http://user%40test:p%3Ass@127.0.0.1:${fixture.proxyPort}`,
        lastTest: null,
      })
      const service = new ProxyService({
        store,
        checkUrl: `http://127.0.0.1:${fixture.targetPort}/trace`,
        ensureBrowserProxyProtection: allowSyntheticProbe,
        startProxyRuntime: createXrayRuntimeStarter({
          hostArch: process.arch,
          resourcesPath: directory,
          env: {},
        }),
      })
      await expect(service.checkEgress("proxy")).resolves.toMatchObject({ ok: true })
    } finally {
      await fixture.close()
      await rm(directory, { recursive: true, force: true })
    }
  })
})

async function portIsOpen(url: URL): Promise<boolean> {
  return await new Promise((resolve) => {
    const socket = connect(Number(url.port), url.hostname)
    socket.once("connect", () => {
      socket.destroy()
      resolve(true)
    })
    socket.once("error", () => resolve(false))
  })
}

async function createProxyFixture(credentials = "user@test:p:ss"): Promise<{
  targetPort: number
  proxyPort: number
  accepted: () => number
  targetRequests: () => number
  failProxy: () => void
  onTarget: (callback: (count: number) => Promise<void>) => void
  close: () => Promise<void>
}> {
  let accepted = 0
  let targetRequests = 0
  let dropping = false
  let onTarget: (count: number) => Promise<void> = async () => undefined
  const sockets = new Set<Socket>()
  const target = createHttpServer((_request, response) => {
    targetRequests += 1
    void onTarget(targetRequests).then(() => response.end("ip=198.51.100.42\n"))
  })
  const targetPort = await listen(target)
  const proxy = createHttpServer()
  proxy.on("connection", (socket) => {
    sockets.add(socket)
    socket.on("close", () => sockets.delete(socket))
    if (dropping) socket.destroy()
  })
  proxy.on("connect", (request, socket, head) => {
    const expected = `Basic ${Buffer.from(credentials).toString("base64")}`
    if (
      request.url !== `127.0.0.1:${targetPort}` ||
      request.headers["proxy-authorization"] !== expected
    ) {
      socket.end("HTTP/1.1 407 Proxy Authentication Required\r\nConnection: close\r\n\r\n")
      return
    }
    const upstream = connect(targetPort, "127.0.0.1", () => {
      accepted += 1
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n")
      if (head.length !== 0) upstream.write(head)
      socket.pipe(upstream).pipe(socket)
    })
    sockets.add(upstream)
    upstream.on("close", () => sockets.delete(upstream))
    upstream.on("error", () => socket.destroy())
    socket.on("error", () => upstream.destroy())
  })
  const proxyPort = await listen(proxy)
  return {
    targetPort,
    proxyPort,
    accepted: () => accepted,
    targetRequests: () => targetRequests,
    onTarget: (callback) => {
      onTarget = callback
    },
    failProxy: () => {
      dropping = true
      for (const socket of sockets) socket.destroy()
    },
    close: async () => {
      for (const socket of sockets) socket.destroy()
      target.closeAllConnections()
      await Promise.all([
        new Promise<void>((resolve) => target.close(() => resolve())),
        new Promise<void>((resolve) => proxy.close(() => resolve())),
      ])
    },
  }
}

async function listen(server: ReturnType<typeof createHttpServer>): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("合成服务未监听")
  return address.port
}
