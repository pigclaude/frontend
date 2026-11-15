// 通过会话启动和真实 daemon 验证 Claude Code 的本机代理环境、换号及失败行为；所有网络请求都使用本机替身。

import { createServer, request as httpRequest, type Server } from "node:http"
import { connect, type Socket } from "node:net"
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client, EnvHttpProxyAgent, fetch, ProxyAgent } from "undici"
import { query } from "@anthropic-ai/claude-agent-sdk"
import { expect, it, vi } from "vitest"
import { account, harness, proxy, type Harness } from "../runtime/local-runtime-fixtures"
import { ProjectTrustStore, projectTrustFilePath } from "../runtime/project-trust-store"
import { accountSessionProfile } from "./account-session-profile"
import { ClaudeAgentAdapter } from "./claude-agent-adapter"
import { resolveClaudeBinaryPath } from "./claude-binary"
import { startClaudeLocalGateway } from "./claude-local-gateway-fixture"
import { placeholderOAuthToken } from "./session-environment"
import type { SessionRuntime } from "./session-types"
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

const nativeBinary = bundledBinary()

it.skipIf(nativeBinary === null)(
  "可信项目不能改变真实 CLI 的 daemon 地址、认证和账号绑定代理",
  async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "pigclaude-trusted-routing-")))
    const home = join(root, "home")
    const workspace = join(root, "project")
    const settings = join(workspace, ".claude")
    const data = join(root, "data")
    const unbound = "http://127.0.0.1:1"
    await mkdir(home)
    await mkdir(settings, { recursive: true })
    await writeFile(
      join(settings, "settings.json"),
      JSON.stringify({
        env: {
          ANTHROPIC_BASE_URL: unbound,
          ANTHROPIC_AUTH_TOKEN: "project-auth",
          ANTHROPIC_API_KEY: "project-api-key",
          CLAUDE_CODE_OAUTH_TOKEN: "project-oauth",
          ANTHROPIC_CUSTOM_HEADERS: "x-pigclaude-session: project-session",
          HTTP_PROXY: unbound,
          HTTPS_PROXY: unbound,
          NO_PROXY: "*",
          ALL_PROXY: unbound,
          http_proxy: unbound,
          https_proxy: unbound,
          no_proxy: "*",
          all_proxy: unbound,
        },
      }),
    )
    await new ProjectTrustStore(projectTrustFilePath(data)).setTrusted(workspace, true)
    const upstream = await startClaudeLocalGateway("token-bound-account")
    const upstreamUrl = new URL(upstream.url)
    const boundProxy = await fakeProxy(upstreamUrl, "bound")
    const { runtime, store, membership, cleanup } = await harness({
      accounts: [account("bound-account", { proxyId: "bound" })],
      proxies: [{ ...proxy("bound"), url: boundProxy.url }],
      upstreamOrigin: upstreamUrl,
    })
    let stopIngress = async (): Promise<void> => undefined
    let host: SessionHost | undefined
    try {
      await runtime.start()
      const daemonAddress = runtime.daemonBaseUrl
      if (daemonAddress === null) throw new Error("合成 daemon 未就绪")
      let sessionToken: string | undefined
      let bridge: string | undefined
      const ingress = await observeDaemonIngress(daemonAddress, () => sessionToken)
      stopIngress = ingress.close
      const observedRuntime: SessionRuntime = {
        daemonBaseUrl: ingress.url,
        hasAvailableAccount: () => runtime.hasAvailableAccount(),
        subscribe: (listener) => runtime.subscribe(listener),
        openSession: (input) => {
          const lease = runtime.openSession(input)
          sessionToken = lease.token
          return {
            ...lease,
            bindEnvironment: async (...args) => {
              const result = await lease.bindEnvironment(...args)
              bridge = result.proxyBridgeUrl
              return result
            },
          }
        },
      }
      let cliUsesBoundBridge = false
      let finished = false
      host = new SessionHost({
        membership: { ...membership, inspect: async () => membership.view() },
        runtime: observedRuntime,
        userDataPath: data,
        resolveBinaryPath: () => nativeBinary ?? "",
        usage: new UsageRecorder({ filePath: join(root, "usage.jsonl") }),
        resolveProfile: (id) => accountSessionProfile(store, id, () => "en-US"),
        createAdapter: (onEvent) =>
          new ClaudeAgentAdapter({
            onEvent: (event) => {
              finished ||= event.type === "result" && !event.isError
              onEvent(event)
            },
            queryFn: ({ prompt, options }) => {
              cliUsesBoundBridge =
                bridge !== undefined &&
                options.env?.HTTP_PROXY === bridge &&
                options.env.HTTPS_PROXY === bridge &&
                options.env.NO_PROXY?.split(",").includes("127.0.0.1") === true
              return query({
                prompt,
                options: {
                  ...options,
                  env: {
                    ...options.env,
                    HOME: home,
                    USERPROFILE: home,
                    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
                    ...(process.platform === "win32"
                      ? {
                          SystemRoot: process.env.SystemRoot,
                          ComSpec: process.env.ComSpec,
                          PATHEXT: process.env.PATHEXT,
                        }
                      : { SHELL: "/bin/bash" }),
                  },
                },
              })
            },
          }),
      })
      const { sessionId } = await host.start({
        workspace,
        accountId: "bound-account",
        model: "sonnet",
        permissionMode: "default",
      })
      const text = "trusted-project-fixed-routing-synthetic-turn"
      await host.send(sessionId, { text, effort: "low" })
      await vi.waitFor(() => expect(finished).toBe(true), { timeout: 15_000 })
      expect(cliUsesBoundBridge).toBe(true)
      expect(ingress.receipts).toContainEqual({ matchedSession: true, placeholderOAuth: true })
      expect(upstream.messages.find(({ body }) => body.includes(text))).toMatchObject({
        hasSessionHeader: false,
        hasPlaceholderCredential: false,
        hasExpectedOAuthCredential: true,
      })
      expect(boundProxy.tunnels.length).toBeGreaterThan(0)
      expect(new Set(boundProxy.tunnels)).toEqual(new Set([upstreamUrl.host]))
    } finally {
      await host?.dispose()
      await stopIngress()
      await cleanup()
      await boundProxy.close()
      await upstream.close()
      await rm(root, { recursive: true, force: true })
    }
  },
  25_000,
)

function bundledBinary(): string | null {
  try {
    return resolveClaudeBinaryPath({ env: {} })
  } catch {
    return null
  }
}

// 只在回环转送到真实 daemon，留下两个已匹配的布尔结果供验收。
async function observeDaemonIngress(daemon: string, currentToken: () => string | undefined) {
  const receipts: Array<{ matchedSession: boolean; placeholderOAuth: boolean }> = []
  const server = createServer((request, response) => {
    const path = request.url ?? "/"
    if (request.method === "POST" && path.split("?")[0] === "/v1/messages") {
      const token = currentToken()
      receipts.push({
        matchedSession: token !== undefined && request.headers["x-pigclaude-session"] === token,
        placeholderOAuth:
          request.headers.authorization === `Bearer ${placeholderOAuthToken}` &&
          request.headers["x-api-key"] === undefined,
      })
    }
    const connection = httpRequest(
      daemon,
      { path, method: request.method, headers: request.headers },
      (upstream) => {
        response.writeHead(upstream.statusCode ?? 502, upstream.headers)
        upstream.pipe(response)
      },
    )
    connection.on("error", () => response.destroy())
    response.on("close", () => connection.destroy())
    request.pipe(connection)
  })
  const url = await listen(server)
  return {
    url: url.origin,
    receipts,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
        server.closeAllConnections()
      }),
  }
}

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
