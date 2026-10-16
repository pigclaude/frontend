// 本机转发 daemon。只监听 127.0.0.1，把请求经账号代理送到 Anthropic，并且只在消息接口替换凭据。

import { once } from "node:events"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { ProxyAgent, fetch as undiciFetch } from "undici"

const upstreamOrigin = "https://api.anthropic.com"

const skipRequestHeader = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "trailers",
  "transfer-encoding",
  "upgrade",
])

const skipResponseHeader = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "trailers",
  "transfer-encoding",
  "upgrade",
])

type ChosenAccount = {
  id: string
  authorization: string
  proxyUrl: string
}

type ChooseAccount = (attempt: { rejectedIds: string[] }) => ChosenAccount | null

/** 本机 Anthropic 转发。保证只听 127.0.0.1，上游都走账号代理，代理不可用时返回 proxy_unavailable。 */
export class LocalDaemon {
  /** 监听端口。start 完成之后保证是 127.0.0.1 上的实际端口。 */
  port: number

  readonly #choose: ChooseAccount
  readonly #server: Server

  /** 保证用给定端口和选号函数准备服务，此时尚未监听。 */
  constructor(options: { port: number; choose: ChooseAccount }) {
    this.port = options.port
    this.#choose = options.choose
    this.#server = createServer((request, response) => {
      void this.#handle(request, response)
    })
  }

  /** 保证开始在 127.0.0.1 上接受连接，并把 port 设为实际端口。 */
  async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        reject(error)
      }
      this.#server.once("error", onError)
      this.#server.listen(this.port, "127.0.0.1", () => {
        this.#server.off("error", onError)
        const address = this.#server.address()
        if (address === null || typeof address === "string") {
          reject(new Error("daemon did not bind a port"))
          return
        }
        this.port = address.port
        resolve()
      })
    })
  }

  /** 保证停止接受连接并断开已经连上的客户端。 */
  async stop(): Promise<void> {
    if (!this.#server.listening) return
    this.#server.closeAllConnections()
    await new Promise<void>((resolve, reject) => {
      this.#server.close((error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  }

  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      await this.#forward(request, response)
    } catch {
      writeUnavailable(response)
    }
  }

  async #forward(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const chosen = this.#choose({ rejectedIds: [] })
    const upstreamUrl = upstreamUrlFor(request.url)
    if (chosen === null || chosen.proxyUrl === "" || upstreamUrl === null) {
      request.resume()
      writeUnavailable(response)
      return
    }
    const method = request.method ?? "GET"
    const headers = requestHeaders(request)
    if (method === "POST" && upstreamUrl.pathname === "/v1/messages") {
      headers.set("authorization", `Bearer ${chosen.authorization}`)
    }
    const body = await readBody(request)
    const agent = new ProxyAgent(chosen.proxyUrl)
    try {
      const upstream = await fetchThroughProxy(agent, {
        url: upstreamUrl,
        method,
        headers,
        body: method === "GET" || method === "HEAD" || body.length === 0 ? undefined : body,
      })
      await writeUpstream(response, upstream)
    } finally {
      await agent.close()
    }
  }
}

// 只有带上代理 dispatcher 才会发出上游请求。没有 proxyUrl 时调用方直接返回 503。
function fetchThroughProxy(
  agent: ProxyAgent,
  input: { url: URL; method: string; headers: Headers; body: Buffer | undefined },
): ReturnType<typeof undiciFetch> {
  return undiciFetch(input.url, {
    method: input.method,
    headers: input.headers,
    body: input.body,
    dispatcher: agent,
    redirect: "manual",
  })
}

function upstreamUrlFor(requestUrl: string | undefined): URL | null {
  let incoming: URL
  try {
    incoming = new URL(requestUrl ?? "/", "http://127.0.0.1")
  } catch {
    return null
  }
  if (!incoming.pathname.startsWith("/") || incoming.pathname.startsWith("//")) return null
  const upstream = new URL(incoming.pathname + incoming.search, upstreamOrigin)
  if (upstream.protocol !== "https:" || upstream.host !== "api.anthropic.com") return null
  return upstream
}

function requestHeaders(request: IncomingMessage): Headers {
  const headers = new Headers()
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined || skipRequestHeader.has(name)) continue
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item)
    } else {
      headers.set(name, value)
    }
  }
  return headers
}

function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    request.on("data", (chunk: Buffer | string) => {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk)
    })
    request.on("end", () => {
      resolve(Buffer.concat(chunks))
    })
    request.on("error", reject)
  })
}

async function writeUpstream(
  response: ServerResponse,
  upstream: Awaited<ReturnType<typeof undiciFetch>>,
): Promise<void> {
  const headers: Record<string, string> = {}
  upstream.headers.forEach((value, key) => {
    if (!skipResponseHeader.has(key)) headers[key] = value
  })
  response.writeHead(upstream.status, headers)
  if (upstream.body === null) {
    response.end()
    return
  }
  const reader = upstream.body.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!response.write(value)) await once(response, "drain")
  }
  response.end()
}

function writeUnavailable(response: ServerResponse): void {
  if (response.writableEnded) return
  if (response.headersSent) {
    response.destroy()
    return
  }
  response.writeHead(503, { "content-type": "application/json" })
  response.end(JSON.stringify({ error: "proxy_unavailable" }))
}
