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
      response.on("error", () => undefined)
      request.on("error", () => undefined)
      void this.#handle(request, response).catch(() => undefined)
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
    if (request.aborted || response.destroyed) return
    const agent = new ProxyAgent(chosen.proxyUrl)
    const abort = new AbortController()
    const stopWatching = watchClient(request, response, abort)
    try {
      const upstream = await fetchThroughProxy(agent, {
        url: upstreamUrl,
        method,
        headers,
        body: method === "GET" || method === "HEAD" || body.length === 0 ? undefined : body,
        signal: abort.signal,
      })
      if (abort.signal.aborted || response.destroyed) {
        await upstream.body?.cancel().catch(() => undefined)
        return
      }
      await writeUpstream(response, upstream, method)
    } finally {
      stopWatching()
      await agent.close()
    }
  }
}

// 只有带上代理 dispatcher 才会发出上游请求。没有 proxyUrl 时调用方直接返回 503。
function fetchThroughProxy(
  agent: ProxyAgent,
  input: {
    url: URL
    method: string
    headers: Headers
    body: Buffer | undefined
    signal: AbortSignal
  },
): ReturnType<typeof undiciFetch> {
  return undiciFetch(input.url, {
    method: input.method,
    headers: input.headers,
    body: input.body,
    dispatcher: agent,
    redirect: "manual",
    signal: input.signal,
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
  if (request.aborted || request.destroyed) return Promise.reject(new Error("client aborted"))
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let settled = false
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      request.off("data", onData)
      request.off("end", onEnd)
      request.off("error", onError)
      request.off("aborted", onAbort)
      request.off("close", onClose)
      if (error) reject(error)
      else resolve(Buffer.concat(chunks))
    }
    const onData = (chunk: Buffer | string): void => {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk)
    }
    const onEnd = (): void => {
      finish()
    }
    const onError = (error: Error): void => {
      finish(error)
    }
    const onAbort = (): void => {
      finish(new Error("client aborted"))
    }
    const onClose = (): void => {
      if (!request.complete) finish(new Error("client aborted"))
    }
    request.on("data", onData)
    request.on("end", onEnd)
    request.on("error", onError)
    request.on("aborted", onAbort)
    request.on("close", onClose)
  })
}

// undici 会解开 gzip、x-gzip、deflate 和 br，但留下压缩时的 content-encoding 与 content-length。
const decodedByUndici = new Set(["gzip", "x-gzip", "deflate", "br"])
const nullBodyStatus = new Set([101, 204, 205, 304])

function undiciDecodedBody(status: number, method: string, encoding: string | null): boolean {
  if (method === "HEAD" || method === "CONNECT" || nullBodyStatus.has(status)) return false
  if (encoding === null) return false
  const codings = encoding
    .toLowerCase()
    .split(",")
    .map((coding) => coding.trim())
    .filter((coding) => coding.length > 0)
  return codings.length > 0 && codings.every((coding) => decodedByUndici.has(coding))
}

async function writeUpstream(
  response: ServerResponse,
  upstream: Awaited<ReturnType<typeof undiciFetch>>,
  method: string,
): Promise<void> {
  const headers = forwardHeaders(upstream, method)
  const body = upstream.body
  if (body === null) {
    writeHeadOrIgnore(response, upstream.status, headers)
    endOrIgnore(response)
    return
  }
  const reader = body.getReader()
  const gone = clientGone(response)
  try {
    if (!response.destroyed) writeHeadOrIgnore(response, upstream.status, headers)
    while (!response.destroyed && !response.writableEnded) {
      const outcome = await Promise.race([
        readChunk(reader),
        gone.then(() => ({ type: "gone" as const })),
      ])
      if (outcome.type !== "chunk") break
      let wrote = true
      try {
        wrote = response.write(outcome.value)
      } catch {
        break
      }
      if (wrote) continue
      const drained = await Promise.race([
        once(response, "drain").then(
          () => true,
          () => false,
        ),
        gone.then(() => false),
      ])
      if (!drained || response.destroyed) break
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
  endOrIgnore(response)
}

function forwardHeaders(
  upstream: Awaited<ReturnType<typeof undiciFetch>>,
  method: string,
): Record<string, string> {
  const decoded = undiciDecodedBody(
    upstream.status,
    method,
    upstream.headers.get("content-encoding"),
  )
  const headers: Record<string, string> = {}
  upstream.headers.forEach((value, key) => {
    if (skipResponseHeader.has(key)) return
    if (decoded && (key === "content-encoding" || key === "content-length")) return
    headers[key] = value
  })
  return headers
}

function readChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<{ type: "chunk"; value: Uint8Array } | { type: "done" }> {
  return reader
    .read()
    .then((result) => (result.done ? { type: "done" } : { type: "chunk", value: result.value }))
}

function clientGone(response: ServerResponse): Promise<void> {
  if (response.destroyed) return Promise.resolve()
  return new Promise((resolve) => {
    const done = (): void => {
      response.off("close", done)
      response.off("error", done)
      resolve()
    }
    response.on("close", done)
    response.on("error", done)
  })
}

function watchClient(
  request: IncomingMessage,
  response: ServerResponse,
  abort: AbortController,
): () => void {
  const stop = (): void => {
    if (!abort.signal.aborted) abort.abort()
  }
  const onAbort = (): void => {
    stop()
  }
  const onRequestClose = (): void => {
    if (!request.complete) stop()
  }
  const onResponseClose = (): void => {
    if (!response.writableEnded) stop()
  }
  request.on("aborted", onAbort)
  request.on("close", onRequestClose)
  response.on("close", onResponseClose)
  return () => {
    request.off("aborted", onAbort)
    request.off("close", onRequestClose)
    response.off("close", onResponseClose)
  }
}

function writeHeadOrIgnore(
  response: ServerResponse,
  status: number,
  headers: Record<string, string>,
): void {
  if (response.destroyed || response.headersSent || response.writableEnded) return
  try {
    response.writeHead(status, headers)
  } catch {
    // The client socket is already gone.
  }
}

function endOrIgnore(response: ServerResponse): void {
  if (response.destroyed || response.writableEnded) return
  try {
    response.end()
  } catch {
    // The client socket is already gone.
  }
}

function writeUnavailable(response: ServerResponse): void {
  response.on("error", () => undefined)
  if (response.writableEnded || response.destroyed) return
  if (response.headersSent) {
    response.destroy()
    return
  }
  try {
    response.writeHead(503, { "content-type": "application/json" })
    response.end(JSON.stringify({ error: "proxy_unavailable" }))
  } catch {
    // writeHead throws ERR_STREAM_DESTROYED once the socket is gone.
  }
}
