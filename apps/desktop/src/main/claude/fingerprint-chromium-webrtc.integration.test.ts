// 用真实浏览器和 Xray 验证代理停止后 WebRTC 不会直接连接本机 UDP/TCP。

import { createSocket } from "node:dgram"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { createServer, type Server } from "node:http"
import { createServer as createTcpServer, type Server as TcpServer } from "node:net"
import { networkInterfaces, tmpdir } from "node:os"
import { join } from "node:path"
import type { ClaudeFingerprintView } from "@pigclaude/contracts/claude-account"
import { chromium, type Browser, type Page } from "@playwright/test"
import { expect, it } from "vitest"
import { FingerprintChromiumAdapter, type LaunchBrowserNetwork } from "./fingerprint-chromium"
import { SubscriptionOAuth } from "./subscription-oauth"
import { createXrayRuntimeStarter } from "./xray-runtime"

const browserBinary = process.env["PIGCLAUDE_TEST_CHROMIUM_BIN"]
const xrayBinary = process.env["PIGCLAUDE_TEST_XRAY_BIN"]

class SyntheticProtectedBrowser extends FingerprintChromiumAdapter {
  /** 合成测试只验证当前内核的网络行为，不改变产品门禁。 */
  override ensureBoundProxyProtection(): void {}
}

it.skipIf(!browserBinary || !xrayBinary)(
  "Xray 退出后不直连 WebRTC UDP 和 TCP",
  async () => {
    if (!browserBinary || !xrayBinary) throw new Error("缺少测试二进制")
    const address = Object.values(networkInterfaces())
      .flat()
      .find((item) => item?.family === "IPv4" && !item.internal)?.address
    if (address === undefined) throw new Error("没有可用于本机 WebRTC 测试的 IPv4 地址")
    const directory = await mkdtemp(join(tmpdir(), "pigclaude-webrtc-bound-"))
    const udp = createSocket("udp4")
    let packets = 0
    udp.on("message", () => {
      packets += 1
    })
    let udpListening = false
    let tcpConnections = 0
    const tcp = createTcpServer((socket) => {
      tcpConnections += 1
      socket.on("error", () => undefined)
      socket.destroy()
    })
    let tcpListening = false
    const control = createServer((_request, response) => response.end("synthetic"))
    let controlListening = false
    const adapter = new SyntheticProtectedBrowser({
      binaryPath: browserBinary,
      hostArch: process.arch,
      profilesRoot: join(directory, "profiles"),
    })
    const start = createXrayRuntimeStarter({ binaryPath: xrayBinary, hostArch: process.arch })
    let runtime: Awaited<ReturnType<typeof start>> | undefined
    let callback: Awaited<ReturnType<SubscriptionOAuth["startCallback"]>> | undefined
    let browser: Browser | undefined
    let browserPid: number | null = null
    let accountId = ""
    let safeToDelete = true
    const launch = async (
      id: string,
      network: LaunchBrowserNetwork,
      url: string,
      webrtcPolicy: ClaudeFingerprintView["webrtcPolicy"],
    ): Promise<Page> => {
      const fingerprint: ClaudeFingerprintView = {
        seed: "42",
        brand: "Chrome",
        platform: "macos",
        lang: "en-US",
        timezone: "UTC",
        canvasNoise: "",
        clientRectsNoise: "",
        webrtcPolicy,
        unknownArgs: [
          "--headless=new",
          "--remote-debugging-port=0",
          "--disable-background-networking",
          "--disable-component-update",
          "--disable-default-apps",
          "--use-mock-keychain",
        ],
      }
      const started = await adapter.launch({
        accountId: id,
        authorizeUrl: url,
        network,
        fingerprint,
      })
      safeToDelete = false
      browserPid = started.pid
      accountId = id
      const port = await debugPort(join(adapter.profileDir(id), "DevToolsActivePort"))
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
      const context = browser.contexts()[0]
      if (context === undefined) throw new Error("浏览器上下文不可用")
      const page = context.pages()[0] ?? (await context.newPage())
      await page.goto(url, { timeout: 5_000 })
      return page
    }
    const stopBrowser = async (): Promise<void> => {
      if (browser === undefined) throw new Error("浏览器未连接")
      const active = browser
      try {
        const session = await within(active.newBrowserCDPSession(), 2_000)
        await within(session.send("Browser.close"), 2_000)
        if (!(await waitForExit(browserPid))) throw new Error("浏览器未确认正常退出")
      } finally {
        try {
          await adapter.stop(accountId)
        } finally {
          await within(active.close(), 2_000)
        }
      }
      browser = undefined
      browserPid = null
      safeToDelete = true
    }
    try {
      await new Promise<void>((resolve, reject) => {
        udp.once("error", reject)
        udp.bind(0, address, resolve)
      })
      udpListening = true
      const udpAddress = udp.address()
      if (typeof udpAddress === "string") throw new Error("UDP 夹具未监听")
      const tcpPort = await listenTcp(tcp, address)
      tcpListening = true
      const controlPort = await listen(control)
      controlListening = true
      const page = await launch(
        "control",
        { mode: "system" },
        `http://127.0.0.1:${controlPort}/`,
        "default_public_and_private_interfaces",
      )
      const beforeControl = packets
      await gather(page, address, udpAddress.port, "udp")
      expect(packets - beforeControl).toBeGreaterThan(0)
      const beforeControlTcp = tcpConnections
      await gather(page, address, tcpPort, "tcp")
      expect(tcpConnections - beforeControlTcp).toBeGreaterThan(0)
      await stopBrowser()

      runtime = await start({ upstreamProxyUrl: "http://127.0.0.1:9" })
      callback = await new SubscriptionOAuth().startCallback({
        state: "synthetic-state",
        timeoutMs: 60_000,
      })
      const callbackUrl = new URL(callback.redirectUri)
      callbackUrl.searchParams.set("state", "synthetic-state")
      callbackUrl.searchParams.set("code", "synthetic-code")
      const boundPage = await launch(
        "bound",
        { mode: "bound", bridgeUrl: runtime.url, callbackUri: callback.redirectUri },
        callbackUrl.href,
        "",
      )
      await expect(callback.waitForCode()).resolves.toBe("synthetic-code")
      const beforeBound = packets
      const beforeBoundTcp = tcpConnections
      await gather(boundPage, address, udpAddress.port, "udp")
      expect(packets).toBe(beforeBound)
      await gather(boundPage, address, tcpPort, "tcp")
      expect(tcpConnections).toBe(beforeBoundTcp)
      await runtime.close()
      await gather(boundPage, address, udpAddress.port, "udp")
      expect(packets).toBe(beforeBound)
      await gather(boundPage, address, tcpPort, "tcp")
      expect(tcpConnections).toBe(beforeBoundTcp)
      await stopBrowser()
    } finally {
      let failed = false
      if (browser !== undefined) {
        try {
          await stopBrowser()
        } catch {
          failed = true
        }
      }
      try {
        await adapter.dispose()
      } catch {
        failed = true
      }
      const results = await Promise.allSettled([
        runtime?.close(),
        start.dispose(),
        callback?.close(),
        udpListening ? new Promise<void>((resolve) => udp.close(() => resolve())) : undefined,
        tcpListening ? closeTcp(tcp) : undefined,
        controlListening ? close(control) : undefined,
      ])
      if (results.some((entry) => entry.status === "rejected")) failed = true
      if (!safeToDelete || failed)
        throw new Error(`浏览器或测试资源未确认回收，保留临时目录 ${directory}`)
      await rm(directory, { recursive: true, force: true })
    }
  },
  60_000,
)

async function gather(page: Page, host: string, port: number, mode: "udp" | "tcp"): Promise<void> {
  await page.evaluate(
    async ({ host, port, mode }) => {
      const web = globalThis as unknown as {
        RTCPeerConnection: new (input: {
          iceServers: Array<{ urls: string; username?: string; credential?: string }>
        }) => {
          createDataChannel: (label: string) => void
          createOffer: () => Promise<unknown>
          setLocalDescription: (offer: unknown) => Promise<void>
          close: () => void
        }
      }
      const iceServer =
        mode === "udp"
          ? { urls: `stun:${host}:${port}` }
          : {
              urls: `turn:${host}:${port}?transport=tcp`,
              username: "synthetic",
              credential: "synthetic",
            }
      const peer = new web.RTCPeerConnection({ iceServers: [iceServer] })
      try {
        peer.createDataChannel("synthetic")
        await peer.setLocalDescription(await peer.createOffer())
        await new Promise((resolve) => setTimeout(resolve, 2_500))
      } finally {
        peer.close()
      }
    },
    { host, port, mode },
  )
}

async function debugPort(path: string): Promise<number> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try {
      const value = Number((await readFile(path, "utf8")).split("\n")[0])
      if (Number.isInteger(value) && value > 0 && value <= 65_535) return value
    } catch {
      /* 等待调试端口文件出现。 */
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error("浏览器调试端口未就绪")
}

async function waitForExit(pid: number | null): Promise<boolean> {
  if (pid === null) return false
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0)
    } catch (error: unknown) {
      return error instanceof Error && "code" in error && error.code === "ESRCH"
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return false
}

async function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("浏览器操作超时")), ms)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const value = server.address()
  if (value === null || typeof value === "string") throw new Error("对照服务未监听")
  return value.port
}

async function listenTcp(server: TcpServer, host: string): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, host, resolve)
  })
  const value = server.address()
  if (value === null || typeof value === "string") throw new Error("TCP 夹具未监听")
  return value.port
}

async function closeTcp(server: TcpServer): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
}

async function close(server: Server): Promise<void> {
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
}
