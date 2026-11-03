// 验证移除自写代理桥后，缺少外部代理核心时拒绝绑定链路，系统网络授权继续可用。

import { createServer } from "node:http"
import { describe, expect, it } from "vitest"
import { createHarness, fingerprint } from "./account-service-test-fixtures"
import { ProxyService } from "./proxy-service"
import { createXrayRuntimeStarter } from "./xray-runtime"

const xrayBinary = process.env["PIGCLAUDE_TEST_XRAY_BIN"]

describe("外部代理核心接入边界", () => {
  it("缺少运行时时不创建授权回调、不检查出口、不启动浏览器", async () => {
    const harness = await createHarness({ proxyRuntimeUnavailable: true })
    try {
      await expect(
        harness.service.authorize({ displayName: "合成账号", proxyId: "p1", fingerprint }),
      ).rejects.toMatchObject({
        code: "PROXY_UNAVAILABLE",
        message: expect.stringContaining("Xray"),
      })
      expect(harness.bridgeCalls).toEqual([])
      expect(harness.egressCalls).toEqual([])
      expect(harness.callbackCalls).toEqual([])
      expect(harness.launchInputs).toEqual([])
      expect(await harness.store.listAccounts()).toEqual([])
    } finally {
      await harness.cleanup()
    }
  })

  it("系统网络授权不依赖外部代理核心", async () => {
    const harness = await createHarness({ proxyRuntimeUnavailable: true })
    try {
      const result = await harness.service.authorize({
        displayName: "系统网络",
        proxyId: null,
        fingerprint,
      })
      expect(result.proxyId).toBeNull()
      expect(harness.launchInputs[0]?.network).toEqual({ mode: "system" })
      expect(harness.bridgeCalls).toEqual([])
      expect(harness.egressCalls).toEqual([])
    } finally {
      await harness.cleanup()
    }
  })

  it("出口核对缺少运行时时不会连接代理或目标", async () => {
    const harness = await createHarness()
    let connections = 0
    const server = createServer((_request, response) => response.end("ip=198.51.100.1\n"))
    server.on("connection", () => {
      connections += 1
    })
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject)
        server.listen(0, "127.0.0.1", resolve)
      })
      const address = server.address()
      if (address === null || typeof address === "string") throw new Error("合成服务未监听")
      const url = `http://127.0.0.1:${address.port}`
      await harness.store.saveProxy({
        schemaVersion: 1,
        id: "local",
        name: "合成代理",
        url,
        lastTest: null,
      })
      const service = new ProxyService({ store: harness.store, checkUrl: `${url}/check` })
      await expect(service.checkEgress("local")).rejects.toMatchObject({
        code: "PROXY_UNAVAILABLE",
        message: expect.stringContaining("Xray"),
      })
      expect(connections).toBe(0)
    } finally {
      server.closeAllConnections()
      if (server.listening) {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()))
        })
      }
      await harness.cleanup()
    }
  })

  it("出口核对拒绝无效入口并回收运行时", async () => {
    const harness = await createHarness()
    let connections = 0
    let closed = 0
    const server = createServer((_request, response) => response.end("unexpected"))
    server.on("connection", () => {
      connections += 1
    })
    server.on("connect", (_request, socket) => {
      socket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n")
    })
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject)
        server.listen(0, "127.0.0.1", resolve)
      })
      const address = server.address()
      if (address === null || typeof address === "string") throw new Error("合成服务未监听")
      const url = `http://127.0.0.1:${address.port}`
      await harness.store.saveProxy({
        schemaVersion: 1,
        id: "local",
        name: "合成代理",
        url,
        lastTest: null,
      })
      const invalidUrls = [
        `socks5://user:secret@127.0.0.1:${address.port}`,
        `socks5://127.0.0.1:${address.port}/extra`,
        `socks5://localhost:${address.port}`,
        url,
      ]
      for (const invalidUrl of invalidUrls) {
        const service = new ProxyService({
          store: harness.store,
          checkUrl: `${url}/check`,
          ensureBrowserProxyProtection: () => undefined,
          startProxyRuntime: async () => ({
            url: invalidUrl,
            close: async () => {
              closed += 1
            },
          }),
        })
        await expect(service.checkEgress("local")).rejects.toMatchObject({
          code: "PROXY_UNAVAILABLE",
        })
      }
      expect(closed).toBe(invalidUrls.length)
      expect(connections).toBe(0)
    } finally {
      server.closeAllConnections()
      if (server.listening) {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()))
        })
      }
      await harness.cleanup()
    }
  })

  it.skipIf(!xrayBinary)("出口核对使用校验过的同一本机入口快照", async () => {
    if (!xrayBinary) throw new Error("缺少测试用 Xray")
    const harness = await createHarness()
    const start = createXrayRuntimeStarter({ binaryPath: xrayBinary, hostArch: process.arch })
    let reads = 0
    let closed = false
    const body = "ip=198.51.100.42\n"
    const server = createServer()
    server.on("connect", (_request, socket) => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n")
      socket.once("data", () => {
        socket.end(
          `HTTP/1.1 200 OK\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`,
        )
      })
    })
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject)
        server.listen(0, "127.0.0.1", resolve)
      })
      const address = server.address()
      if (address === null || typeof address === "string") throw new Error("合成服务未监听")
      const url = `http://127.0.0.1:${address.port}`
      await harness.store.saveProxy({
        schemaVersion: 1,
        id: "local",
        name: "合成代理",
        url,
        lastTest: null,
      })
      const runtime = await start({ upstreamProxyUrl: url })
      const service = new ProxyService({
        store: harness.store,
        checkUrl: "http://synthetic.invalid/check",
        ensureBrowserProxyProtection: () => undefined,
        startProxyRuntime: async () => ({
          get url() {
            reads += 1
            return reads === 1 ? runtime.url : `${runtime.url}/extra`
          },
          close: async () => {
            closed = true
            await runtime.close()
          },
        }),
      })
      expect(await service.checkEgress("local")).toEqual({ ok: true, ip: "198.51.100.42" })
      expect(reads).toBe(1)
      expect(closed).toBe(true)
    } finally {
      try {
        await start.dispose()
      } finally {
        server.closeAllConnections()
        if (server.listening) {
          await new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()))
          })
        }
        await harness.cleanup()
      }
    }
  })
})
