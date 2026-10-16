// 本机转发 daemon。只监听 127.0.0.1，把请求经账号代理送到 Anthropic，并且只在消息接口替换凭据。
// 额度用尽且尚未向调用方写出响应体时，用下一个账号重试同一条消息请求。
// 已经保存额度用尽响应后，代理抛错会拒绝这个账号并继续选号；还没有保存的 429 时，代理抛错仍返回 proxy_unavailable。

import { once } from "node:events"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { ProxyAgent, fetch as undiciFetch } from "undici"
import { forwardHeaders, requestHeaders } from "./daemon-headers.ts"

const upstreamOrigin = "https://api.anthropic.com"
// 超过 32 MiB 的消息请求体直接返回这次 429，不再为换号重发。
const maxRetryBodyBytes = 32 * 1024 * 1024

type ChosenAccount = {
  id: string
  authorization: string
  proxyUrl: string
}

type ChooseAccount = (attempt: { rejectedIds: string[] }) => ChosenAccount | null

type BufferedUpstream = {
  status: number
  headers: Record<string, string>
  body: Buffer
}

/** 本机 Anthropic 转发。保证只听 127.0.0.1，上游都走账号代理，代理不可用时返回 proxy_unavailable。消息接口在写出响应体前遇到额度用尽时换下一个账号；此时如果下一个代理抛错，就拒绝该账号并继续选号。 */
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
    const upstreamUrl = upstreamUrlFor(request.url)
    if (upstreamUrl === null) {
      request.resume()
      writeUnavailable(response)
      return
    }
    const method = request.method ?? "GET"
    const clientHeaders = requestHeaders(request)
    const messagePost = method === "POST" && upstreamUrl.pathname === "/v1/messages"
    const rejectedIds: string[] = []
    let body: Buffer | null = null
    let savedQuota: BufferedUpstream | null = null
    let switchAccount = true

    while (switchAccount) {
      switchAccount = false
      if (request.aborted || response.destroyed || response.headersSent || response.writableEnded) {
        return
      }
      const chosen = this.#choose({ rejectedIds: rejectedIds.slice() })
      if (chosen === null || chosen.proxyUrl === "" || rejectedIds.includes(chosen.id)) {
        if (savedQuota !== null) writeBuffered(response, savedQuota)
        else {
          request.resume()
          writeUnavailable(response)
        }
        return
      }
      if (body === null) {
        body = await readBody(request)
        if (request.aborted || response.destroyed || response.headersSent) return
      }
      const headers = new Headers(clientHeaders)
      if (messagePost) headers.set("authorization", `Bearer ${chosen.authorization}`)
      const abort = new AbortController()
      const stopWatching = watchClient(request, response, abort)
      let agent: ProxyAgent | undefined
      let continueWithNext = false
      try {
        let upstream: Awaited<ReturnType<typeof undiciFetch>> | undefined
        try {
          agent = new ProxyAgent(chosen.proxyUrl)
          upstream = await fetchThroughProxy(agent, {
            url: upstreamUrl,
            method,
            headers,
            body: method === "GET" || method === "HEAD" || body.length === 0 ? undefined : body,
            signal: abort.signal,
          })
        } catch (error) {
          if (!continueAfterThrownProxy(savedQuota !== null, request, response, abort.signal)) {
            throw error
          }
          rejectedIds.push(chosen.id)
          switchAccount = true
          continueWithNext = true
        }
        if (upstream !== undefined) {
          if (abort.signal.aborted || response.destroyed || response.headersSent) {
            await upstream.body?.cancel().catch(() => undefined)
            return
          }
          if (canSwitchBeforeBody(messagePost, body.length, upstream, response)) {
            const switched = await takeQuotaResponse(response, upstream, method)
            if (switched === null) return
            rejectedIds.push(chosen.id)
            savedQuota = switched
            switchAccount = true
            continue
          }
          await writeUpstream(response, upstream, method)
        }
      } finally {
        stopWatching()
        if (agent !== undefined) {
          const closing = agent.close()
          if (continueWithNext) await closing.catch(() => undefined)
          else await closing
        }
      }
      if (continueWithNext) continue
    }
  }
}

// 已经记下额度用尽响应、并且调用方还在等时，这次代理抛错才换下一个账号。
function continueAfterThrownProxy(
  hasSavedQuota: boolean,
  request: IncomingMessage,
  response: ServerResponse,
  signal: AbortSignal,
): boolean {
  if (!hasSavedQuota) return false
  if (signal.aborted || request.aborted) return false
  if (response.destroyed || response.headersSent || response.writableEnded) return false
  return true
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

function canSwitchBeforeBody(
  messagePost: boolean,
  bodyLength: number,
  upstream: Awaited<ReturnType<typeof undiciFetch>>,
  response: ServerResponse,
): boolean {
  return (
    messagePost &&
    bodyLength <= maxRetryBodyBytes &&
    upstream.status === 429 &&
    upstream.headers.get("x-quota-exhausted") === "1" &&
    !response.headersSent &&
    !response.writableEnded &&
    !response.destroyed
  )
}

async function takeQuotaResponse(
  response: ServerResponse,
  upstream: Awaited<ReturnType<typeof undiciFetch>>,
  method: string,
): Promise<BufferedUpstream | null> {
  try {
    const buffered = await bufferUpstream(upstream, method)
    if (response.destroyed || response.headersSent || response.writableEnded) return null
    return buffered
  } catch {
    if (!response.headersSent && !response.destroyed) {
      writeHeadOrIgnore(response, upstream.status, forwardHeaders(upstream, method))
    }
    if (!response.destroyed) response.destroy()
    return null
  }
}

async function bufferUpstream(
  upstream: Awaited<ReturnType<typeof undiciFetch>>,
  method: string,
): Promise<BufferedUpstream> {
  const headers = forwardHeaders(upstream, method)
  const chunks: Buffer[] = []
  const body = upstream.body
  if (body !== null) {
    const reader = body.getReader()
    try {
      let result = await reader.read()
      while (!result.done) {
        chunks.push(Buffer.from(result.value))
        result = await reader.read()
      }
    } finally {
      await reader.cancel().catch(() => undefined)
    }
  }
  return { status: upstream.status, headers, body: Buffer.concat(chunks) }
}

function writeBuffered(response: ServerResponse, buffered: BufferedUpstream): void {
  if (response.destroyed || response.writableEnded) return
  if (response.headersSent) {
    response.destroy()
    return
  }
  try {
    response.writeHead(buffered.status, buffered.headers)
    response.end(buffered.body)
  } catch {
    // The client socket is already gone.
  }
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
