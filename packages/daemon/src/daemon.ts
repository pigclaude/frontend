// 本机转发 daemon。只监听 127.0.0.1，先校验本机会话令牌，再把请求经账号代理送到 Anthropic，
// 并且只在消息接口替换凭据、合并 OAuth beta 头。
// 额度用尽或消息请求在写出正文前收到 401/403 时，用下一个账号重试同一条消息请求，并把选号和拒绝交给回调。
// 没有可用账号返回 no_available_account，代理为空返回 proxy_unavailable，认证全部失败返回 auth_expired。
// 已经保存额度用尽响应后，代理抛错会拒绝这个账号并继续选号；还没有保存的 429 时，代理抛错仍返回 proxy_unavailable。

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { ProxyAgent, fetch as undiciFetch } from "undici"
import { oauthBetaHeader, requestHeaders, sessionHeaderName } from "./daemon-headers.ts"
import {
  takeQuotaResponse,
  writeBuffered,
  writeErrorResponse,
  writeUpstream,
  type BufferedUpstream,
} from "./daemon-response.ts"

const upstreamOrigin = "https://api.anthropic.com"
// 超过 32 MiB 的消息请求体直接返回这次 429，不再为换号重发。
const maxRetryBodyBytes = 32 * 1024 * 1024

type ChosenAccount = {
  id: string
  authorization: string
  proxyUrl: string
}

type ChooseAccount = (attempt: {
  rejectedIds: string[]
}) => ChosenAccount | null | Promise<ChosenAccount | null>

/** 本机 Anthropic 转发。保证只听 127.0.0.1，先用会话令牌拒绝其他本机进程，上游都走账号代理，代理不可用时返回 proxy_unavailable。消息接口在写出响应体前遇到额度用尽时换下一个账号；此时如果下一个代理抛错，就拒绝该账号并继续选号。 */
export class LocalDaemon {
  /** 监听端口。start 完成之后保证是 127.0.0.1 上的实际端口。 */
  port: number

  readonly #sessionToken: string
  readonly #runAuthorized: <T>(operation: (signal: AbortSignal) => Promise<T>) => Promise<T>
  readonly #choose: ChooseAccount
  readonly #onAccountRejected: (accountId: string, reason: string) => void
  readonly #onAccountSelected: (accountId: string, previousId: string | undefined) => void
  readonly #onExit: () => void
  readonly #server: Server
  #stopping = false

  /** 保证用给定端口、会话令牌、选号函数和回调准备服务，此时尚未监听。 */
  constructor(options: {
    port: number
    sessionToken: string
    choose: ChooseAccount
    runAuthorized: <T>(operation: (signal: AbortSignal) => Promise<T>) => Promise<T>
    onAccountRejected?: (accountId: string, reason: string) => void
    onAccountSelected?: (accountId: string, previousId: string | undefined) => void
    onExit?: () => void
  }) {
    this.port = options.port
    this.#sessionToken = options.sessionToken
    this.#choose = options.choose
    this.#runAuthorized = options.runAuthorized
    this.#onAccountRejected = options.onAccountRejected ?? (() => undefined)
    this.#onAccountSelected = options.onAccountSelected ?? (() => undefined)
    this.#onExit = options.onExit ?? (() => undefined)
    this.#server = createServer((request, response) => {
      response.on("error", () => undefined)
      request.on("error", () => undefined)
      void this.#handle(request, response).catch(() => undefined)
    })
  }

  /** 保证开始在 127.0.0.1 上接受连接，并把 port 设为实际端口；监听后意外关闭会触发 onExit。 */
  async start(): Promise<void> {
    this.#stopping = false
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
        this.#server.once("close", () => {
          if (!this.#stopping) this.#onExit()
        })
        resolve()
      })
    })
  }

  /** 保证停止接受连接并断开已经连上的客户端，且主动停止不触发 onExit。 */
  async stop(): Promise<void> {
    if (!this.#server.listening) return
    this.#stopping = true
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
      await this.#runAuthorized(async (signal) => {
        if (signal.aborted) throw new Error("MEMBERSHIP_REQUIRED")
        const stop = () => response.destroy()
        signal.addEventListener("abort", stop, { once: true })
        try {
          await this.#forward(request, response).catch(() =>
            writeErrorResponse(response, 503, "proxy_unavailable"),
          )
        } finally {
          signal.removeEventListener("abort", stop)
        }
      })
    } catch {
      request.resume()
      if (!response.headersSent && !response.destroyed) {
        response.writeHead(403, { "content-type": "application/json" })
        response.end(JSON.stringify({ error: "membership_required" }))
      }
    }
  }

  async #forward(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.headers[sessionHeaderName] !== this.#sessionToken) {
      request.resume()
      writeErrorResponse(response, 403, "invalid_session_token")
      return
    }
    const upstreamUrl = upstreamUrlFor(request.url)
    if (upstreamUrl === null) {
      request.resume()
      writeErrorResponse(response, 503, "proxy_unavailable")
      return
    }
    const method = request.method ?? "GET"
    const clientHeaders = requestHeaders(request, { sessionToken: this.#sessionToken })
    const messagePost = method === "POST" && upstreamUrl.pathname === "/v1/messages"
    const rejectedIds: string[] = []
    let body: Buffer | null = null
    let savedQuota: BufferedUpstream | null = null
    let switchAccount = true
    let authRejected = false
    let previousId: string | undefined

    while (switchAccount) {
      switchAccount = false
      if (request.aborted || response.destroyed || response.headersSent || response.writableEnded) {
        return
      }
      const chosen = await this.#choose({ rejectedIds: rejectedIds.slice() })
      if (request.aborted || response.destroyed || response.headersSent || response.writableEnded) {
        return
      }
      if (chosen === null || rejectedIds.includes(chosen.id)) {
        request.resume()
        if (authRejected) writeErrorResponse(response, 503, "auth_expired")
        else if (savedQuota !== null) writeBuffered(response, savedQuota)
        else writeErrorResponse(response, 503, "no_available_account")
        return
      }
      if (chosen.proxyUrl === "") {
        request.resume()
        writeErrorResponse(response, 503, authRejected ? "auth_expired" : "proxy_unavailable")
        return
      }
      this.#onAccountSelected(chosen.id, previousId)
      previousId = chosen.id
      if (body === null) {
        body = await readBody(request)
        if (request.aborted || response.destroyed || response.headersSent) return
      }
      const headers = new Headers(clientHeaders)
      if (messagePost) {
        headers.set("authorization", `Bearer ${chosen.authorization}`)
        headers.set("anthropic-beta", oauthBetaHeader(headers.get("anthropic-beta")))
      }
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
          // 消息请求在写出正文前收到 401/403：标记账号失效并换下一个，不重放同一账号。
          if (messagePost && isAuthStatus(upstream.status)) {
            await upstream.body?.cancel().catch(() => undefined)
            this.#onAccountRejected(chosen.id, "auth")
            rejectedIds.push(chosen.id)
            authRejected = true
            switchAccount = true
            continue
          }
          if (canSwitchBeforeBody(messagePost, body.length, upstream, response)) {
            const switched = await takeQuotaResponse(response, upstream, method)
            if (switched === null) return
            this.#onAccountRejected(chosen.id, "quota")
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

function isAuthStatus(status: number): boolean {
  return status === 401 || status === 403
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
