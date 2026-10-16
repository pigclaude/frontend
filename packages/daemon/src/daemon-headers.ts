// 整理转发时的请求头和响应头。丢掉逐跳头；正文已被 undici 解码时不再保留压缩头和原来的长度。

import type { IncomingMessage } from "node:http"

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

type HeaderSource = {
  status: number
  headers: {
    get(name: string): string | null
    forEach(callback: (value: string, key: string) => void): void
  }
}

/** 保证交给上游的请求头不含逐跳头。 */
export function requestHeaders(request: IncomingMessage): Headers {
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

/** 保证交给调用方的响应头不含逐跳头；正文已经解码时也不含压缩头和旧的长度。 */
export function forwardHeaders(upstream: HeaderSource, method: string): Record<string, string> {
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
