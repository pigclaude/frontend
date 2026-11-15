// 通过会话启动和真实 daemon 验证 Claude Code 的本机代理环境、换号及失败行为；所有网络请求都使用本机替身。

import { createServer, type Server } from "node:http"
import { connect, type Socket } from "node:net"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client, EnvHttpProxyAgent, fetch, ProxyAgent } from "undici"
import { expect, it } from "vitest"
import { account, harness, proxy, type Harness } from "../runtime/local-runtime-fixtures"
import { accountSessionProfile } from "./account-session-profile"
import { SessionHost } from "./session-host"
import { AdapterFactory } from "./session-host-fixtures"
import { UsageRecorder } from "./usage-recorder"

it("会话出口随账号切换，代理失败或会话关闭后不能通过原出口访问", async () => {
  let externalRequests = 0
  let exhaustSecondAccount = false
  const origin = createServer((request, response) => {
    request.resume()
    if (request.url === "/v1/messages") {
      const authorization = request.headers.authorization
      const exhausted =
        authorization === "Bearer token-a" ||
        (exhaustSecondAccount && authorization === "Bearer token-b")
      if (exhausted) response.setHeader("x-quota-exhausted", "1")
      response.writeHead(exhausted ? 429 : 200)
    } else {
      externalRequests += 1
    }
    response.end("synthetic")
  })
  const originUrl = await listen(origin)
  const first = await fakeProxy(originUrl, "first")
  const second = await fakeProxy(originUrl, "second")
  const runtime = await harness({
    accounts: [
      account("a", { proxyId: "first" }),
      account("b", { proxyId: "second" }),
      account("direct", { proxyId: null }),
    ],
    proxies: [
      { ...proxy("first"), url: first.url },
      { ...proxy("second"), url: second.url },
    ],
    upstreamOrigin: originUrl,
  })
  const desktop = await fakeSessionHost(runtime)
  try {
    await runtime.runtime.start()
    const id = await desktop.start("a")
    const env = desktop.environments.get(id)
    const address = env?.HTTPS_PROXY
    expect(address).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    if (address === undefined || env === undefined) throw new Error("会话没有本机代理")
    expect(env.HTTP_PROXY).toBe(address)
    expect(env.NO_PROXY?.split(",")).toContain("127.0.0.1")
    expect(Object.values(env).join(" ")).not.toMatch(/secret-|proxy-user/)

    const target = new URL("/external", originUrl)
    expect(await throughBridge(address, target)).toBe("synthetic")
    expect(first.tunnels).toEqual([originUrl.host])
    expect(second.tunnels).toEqual([])
    const proxyClient = new Client(address)
    try {
      const http = await proxyClient.request({ method: "GET", path: target.href })
      expect(http.statusCode).toBe(200)
      expect(await http.body.text()).toBe("first: forward")
    } finally {
      await proxyClient.destroy()
    }
    expect(first.forwarded).toEqual([target.href])

    expect((await postMessage(env)).status).toBe(200)
    expect(first.forwarded).toEqual([target.href])
    expect(await throughBridge(address, target)).toBe("synthetic")
    expect(first.tunnels).toHaveLength(2)
    expect(second.tunnels).toHaveLength(2)

    const directId = await desktop.start("direct")
    const direct = desktop.environments.get(directId)
    expect(direct).toBeDefined()
    expect(direct?.HTTP_PROXY).toBeUndefined()
    expect(direct?.HTTPS_PROXY).toBeUndefined()
    expect(direct?.NO_PROXY).toBeUndefined()

    exhaustSecondAccount = true
    expect(await postMessage(env)).toMatchObject({
      status: 503,
      body: expect.stringContaining("account_environment_mismatch"),
    })

    await second.close()
    await expect(throughBridge(address, target)).rejects.toThrow()
    expect(externalRequests).toBe(2)
    expect(first.tunnels).toHaveLength(2)
    await desktop.host.stop(id)
    await expect(throughBridge(address, target)).rejects.toThrow()
    expect(externalRequests).toBe(2)
  } finally {
    await desktop.close()
    await runtime.cleanup()
    await first.close()
    await second.close()
    origin.closeAllConnections()
    await new Promise<void>((resolve) => origin.close(() => resolve()))
  }
}, 20_000)

async function fakeSessionHost(h: Harness) {
  const path = await mkdtemp(join(tmpdir(), "pigclaude-proxy-routing-"))
  const environments = new Map<string, Record<string, string>>()
  const adapters = new AdapterFactory([])
  const host = new SessionHost({
    membership: { ...h.membership, inspect: async () => h.membership.view() },
    runtime: h.runtime,
    userDataPath: path,
    resolveBinaryPath: () => "/synthetic/claude",
    usage: new UsageRecorder({ filePath: join(path, "usage.jsonl") }),
    resolveProfile: (id) => accountSessionProfile(h.store, id, () => "en-US"),
    createAdapter: adapters.create,
  })
  return {
    host,
    environments,
    start: async (accountId: string) => {
      const { sessionId } = await host.start({
        workspace: path,
        accountId,
        permissionMode: "default",
      })
      const options = adapters.last.startCalls[0]
      if (options !== undefined) environments.set(sessionId, options.env)
      return sessionId
    },
    close: async () => {
      await host.dispose()
      await rm(path, { recursive: true, force: true })
    },
  }
}

async function fakeProxy(target: URL, name: string) {
  const expected = `Basic ${Buffer.from(`proxy-user:secret-${name}`).toString("base64")}`
  const forwarded: string[] = []
  const server = createServer((request, response) => {
    request.resume()
    if (request.headers["proxy-authorization"] !== expected) {
      response.writeHead(407).end()
      return
    }
    forwarded.push(request.url ?? "")
    response.end(`${name}: forward`)
  })
  const connected = new Set<Socket>()
  const tunnels: string[] = []
  server.on("connection", (socket) => {
    connected.add(socket)
    socket.once("close", () => connected.delete(socket))
    socket.on("error", () => socket.destroy())
  })
  server.on("connect", (request, downstream, head) => {
    if (request.headers["proxy-authorization"] !== expected) {
      downstream.end("HTTP/1.1 407 Proxy Authentication Required\r\n\r\n")
      return
    }
    tunnels.push(request.url ?? "")
    const upstream = connect(Number(target.port), target.hostname, () => {
      downstream.write("HTTP/1.1 200 Connection Established\r\n\r\n")
      if (head.length) upstream.write(head)
      downstream.pipe(upstream).pipe(downstream)
    })
    upstream.on("error", () => downstream.destroy())
    downstream.on("close", () => upstream.destroy())
  })
  const endpoint = await listen(server)
  endpoint.username = "proxy-user"
  endpoint.password = `secret-${name}`
  let closing: Promise<void> | undefined
  return {
    url: endpoint.href,
    tunnels,
    forwarded,
    close: () => {
      for (const socket of connected) socket.destroy()
      return (closing ??= new Promise<void>((resolve) => server.close(() => resolve())))
    },
  }
}

async function listen(server: Server): Promise<URL> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("合成服务未监听")
  return new URL(`http://127.0.0.1:${address.port}`)
}

async function postMessage(env: Record<string, string>) {
  const client = new EnvHttpProxyAgent({
    httpProxy: env.HTTP_PROXY ?? "",
    httpsProxy: env.HTTPS_PROXY ?? "",
    noProxy: env.NO_PROXY ?? "",
  })
  try {
    const message = await fetch(`${env.ANTHROPIC_BASE_URL}/v1/messages`, {
      method: "POST",
      headers: { "x-pigclaude-session": env.ANTHROPIC_CUSTOM_HEADERS?.split(": ")[1] ?? "" },
      body: "{}",
      dispatcher: client,
      signal: AbortSignal.timeout(2_500),
    })
    return { status: message.status, body: await message.text() }
  } finally {
    await client.destroy()
  }
}

async function throughBridge(address: string, target: URL): Promise<string> {
  const agent = new ProxyAgent(address)
  try {
    const response = await fetch(target, { dispatcher: agent, signal: AbortSignal.timeout(2_500) })
    return await response.text()
  } finally {
    await agent.destroy()
  }
}
