// 负责 Home 固定后端代理，保留网站 Host、多个 Cookie 与原始接续，日志仅记路径和状态。
import { request as httpRequest } from "node:http"
import { request as httpsRequest } from "node:https"
import { Readable } from "node:stream"
import type { ReadableStream as NodeReadableStream } from "node:stream/web"

const hopHeaders = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
])

function filteredHeaders(input: Headers): Record<string, string> {
  const output: Record<string, string> = {}
  const connection = (input.get("connection") ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
  input.forEach((value, name) => {
    if (
      !hopHeaders.has(name) &&
      !connection.includes(name) &&
      !name.startsWith("x-forwarded-") &&
      name !== "forwarded"
    )
      output[name] = value
  })
  // 网站 Host 由后端精确校验，不能被 Connection 提名后降为后端 Host。
  const host = input.get("host")
  if (host) output.host = host
  return output
}

/** 仅由服务器配置选择固定 origin，调用者 query/Header 不能指定后端或 issuer。 */
export function createBackendProxy(
  configuredTarget: string,
): (request: Request) => Promise<Response> {
  const target = new URL(configuredTarget)
  if (
    (target.protocol !== "https:" &&
      !(
        target.protocol === "http:" &&
        (target.hostname === "127.0.0.1" || (target.hostname === "api" && target.port === "8788"))
      )) ||
    target.username ||
    target.password ||
    target.pathname !== "/" ||
    target.search ||
    target.hash
  )
    throw new Error("无效的固定后端目标")
  const send = target.protocol === "https:" ? httpsRequest : httpRequest
  return async (request) => {
    const url = new URL(request.url)
    const log = (status: number) => console.info(`${request.method} ${url.pathname} ${status}`)
    if (!request.headers.get("host")) {
      log(400)
      return new Response(null, {
        status: 400,
        headers: {
          "Cache-Control": "no-store",
          Pragma: "no-cache",
          "Referrer-Policy": "no-referrer",
        },
      })
    }
    try {
      return await new Promise<Response>((resolve, reject) => {
        const upstream = send(
          {
            protocol: target.protocol,
            hostname: target.hostname,
            port: target.port,
            method: request.method,
            path: `${url.pathname}${url.search}`,
            headers: filteredHeaders(request.headers),
          },
          (response) => {
            const headers = new Headers()
            const connection = (response.headers.connection ?? "")
              .split(",")
              .map((value) => value.trim().toLowerCase())
            for (const [name, values] of Object.entries(response.headers)) {
              if (!values || hopHeaders.has(name) || connection.includes(name)) continue
              for (const value of Array.isArray(values) ? values : [values])
                headers.append(name, value)
            }
            headers.set("Cache-Control", "no-store")
            headers.set("Pragma", "no-cache")
            headers.set("Referrer-Policy", "no-referrer")
            const status = response.statusCode ?? 502
            log(status)
            // node HTTP 不跟随 Location，也不会自动解压而破坏长度或 Cookie 边界。
            const body =
              request.method === "HEAD" || [204, 205, 304].includes(status)
                ? null
                : (Readable.toWeb(response) as ReadableStream<Uint8Array>)
            if (body === null) response.resume()
            resolve(new Response(body, { status, headers }))
          },
        )
        upstream.setTimeout(15_000, () => upstream.destroy(new Error("后端请求超时")))
        upstream.on("error", () => reject(new Error("后端请求失败")))
        const abort = () => upstream.destroy(new Error("请求已取消"))
        request.signal.addEventListener("abort", abort, { once: true })
        upstream.on("close", () => request.signal.removeEventListener("abort", abort))
        if (request.signal.aborted) abort()
        else if (request.body) {
          const body = Readable.fromWeb(request.body as NodeReadableStream<Uint8Array>)
          body.on("error", () => upstream.destroy(new Error("请求体读取失败")))
          body.pipe(upstream)
        } else upstream.end()
      })
    } catch {
      log(502)
      return new Response(JSON.stringify({ error: "server_error" }), {
        status: 502,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          Pragma: "no-cache",
          "Referrer-Policy": "no-referrer",
        },
      })
    }
  }
}
