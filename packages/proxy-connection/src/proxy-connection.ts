// 负责上游 HTTP/HTTPS 与 SOCKS5 代理的请求转发和隧道，不回退直连。

import { once } from "node:events"
import { connect, type Socket } from "node:net"
import type { Duplex } from "node:stream"
import { SocksClient } from "socks"
import { Agent, buildConnector, Client, ProxyAgent, type Dispatcher } from "undici"

const socksConnectTimeoutMs = 15_000

/** 创建指定上游的 dispatcher，凭据只用于和该代理握手。 */
export function createProxyAgent(proxyUrl: string): Dispatcher {
  const url = new URL(proxyUrl)
  if (url.protocol === "socks5:") return new Socks5Agent(url)
  const { endpoint, token } = proxyEndpoint(url)
  return new ProxyAgent({ uri: endpoint.href, ...(token === undefined ? {} : { token }) })
}

class Socks5Agent extends Agent {
  readonly #handshakes: AbortController

  constructor(proxy: URL) {
    const handshakes = new AbortController()
    const tlsConnect = buildConnector({})
    super({
      connect: (options, callback) => {
        const useTls = options.protocol === "https:"
        const port = options.port === "" ? (useTls ? 443 : 80) : Number(options.port)
        const signal = AbortSignal.any([
          handshakes.signal,
          AbortSignal.timeout(socksConnectTimeoutMs),
        ])
        void connectSocks5(proxy, hostname(options.hostname), port, signal).then(
          (socket) => {
            if (!useTls) {
              callback(null, socket)
              return
            }
            const abort = () => socket.destroy()
            signal.addEventListener("abort", abort, { once: true })
            tlsConnect({ ...options, httpSocket: socket }, (...result) => {
              signal.removeEventListener("abort", abort)
              callback(...result)
            })
          },
          (error: unknown) =>
            callback(error instanceof Error ? error : new Error("SOCKS5 连接失败"), null),
        )
      },
    })
    this.#handshakes = handshakes
  }

  /** 销毁时一并取消 Undici 尚未接管的连接。 */
  override destroy(): Promise<void>
  override destroy(error: Error | null): Promise<void>
  override destroy(callback: () => void): void
  override destroy(error: Error | null, callback: () => void): void
  override destroy(
    error?: Error | null | (() => void),
    callback?: () => void,
  ): Promise<void> | void {
    this.#handshakes.abort()
    if (typeof error === "function") return super.destroy(error)
    if (callback !== undefined) return super.destroy(error ?? null, callback)
    return super.destroy(error ?? null)
  }
}

type ForwardOptions = Pick<Dispatcher.RequestOptions, "method" | "body" | "signal"> & {
  headers: Record<string, string | string[] | undefined>
}

/** 普通 HTTP 经 HTTP 代理发绝对请求目标，经 SOCKS5 代理在隧道中发原站请求。 */
export function createHttpProxyForwarder(proxyUrl: string) {
  const url = new URL(proxyUrl)
  if (url.protocol === "socks5:") {
    const agent = createProxyAgent(proxyUrl)
    return {
      request: (target: URL, options: ForwardOptions) =>
        agent.request({
          ...options,
          origin: target.origin,
          path: target.pathname + target.search,
          headers: { ...options.headers, host: target.host },
        }),
      close: () => agent.destroy(),
    }
  }

  const { endpoint, token } = proxyEndpoint(url)
  const client = new Client(endpoint.origin)
  return {
    request: (target: URL, options: ForwardOptions) =>
      client.request({
        ...options,
        path: target.href,
        headers: {
          ...options.headers,
          host: target.host,
          ...(token === undefined ? {} : { "proxy-authorization": token }),
        },
      }),
    close: () => client.destroy(),
  }
}

/** 只经指定上游建立隧道，调用方负责关闭成功返回的 socket。 */
export async function connectProxyTunnel(
  proxyUrl: string,
  authority: string,
  signal: AbortSignal,
): Promise<Duplex> {
  const url = new URL(proxyUrl)
  if (url.protocol === "socks5:") {
    const target = new URL("http://" + authority)
    return connectSocks5(
      url,
      hostname(target.hostname),
      target.port === "" ? 80 : Number(target.port),
      signal,
    )
  }
  const { endpoint, token } = proxyEndpoint(url)
  if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") {
    throw new Error("不支持的上游代理协议")
  }
  const client = new Client(endpoint.origin)
  try {
    const { socket, statusCode } = await client.connect({
      path: authority,
      headers: {
        host: authority,
        ...(token === undefined ? {} : { "proxy-authorization": token }),
      },
      signal,
    })
    socket.on("error", () => undefined)
    if (statusCode !== 200) {
      socket.destroy()
      throw new Error("上游代理拒绝连接")
    }
    return socket
  } finally {
    await client.destroy()
  }
}

async function connectSocks5(
  url: URL,
  host: string,
  port: number,
  signal: AbortSignal,
): Promise<Socket> {
  signal.throwIfAborted()
  const proxy = {
    host: hostname(url.hostname),
    port: url.port === "" ? 1080 : Number(url.port),
    type: 5 as const,
    userId: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  }
  const socket = connect({ host: proxy.host, port: proxy.port })
  const abort = () => socket.destroy()
  signal.addEventListener("abort", abort, { once: true })
  try {
    await once(socket, "connect", { signal })
    const result = await SocksClient.createConnection({
      command: "connect",
      proxy,
      destination: { host, port },
      existing_socket: socket,
      timeout: socksConnectTimeoutMs,
    })
    signal.throwIfAborted()
    result.socket.on("error", () => undefined)
    return result.socket
  } catch (error) {
    socket.destroy()
    signal.throwIfAborted()
    throw error
  } finally {
    signal.removeEventListener("abort", abort)
  }
}

function hostname(value: string): string {
  return value.replace(/^\[|\]$/g, "")
}

function proxyEndpoint(endpoint: URL): { endpoint: URL; token?: string } {
  const username = decodeURIComponent(endpoint.username)
  const password = decodeURIComponent(endpoint.password)
  endpoint.username = ""
  endpoint.password = ""
  if (username === "" && password === "") return { endpoint }
  const token = "Basic " + Buffer.from(username + ":" + password, "utf8").toString("base64")
  return { endpoint, token }
}
