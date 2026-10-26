// daemon 的响应写出工具。负责保存额度用尽响应、把上游响应当成流转发给调用方，
// 以及在客户端断开或写头失败时安全结束。所有写出都容忍 socket 已经关闭。

import { once } from "node:events"
import type { ServerResponse } from "node:http"
import type { ReadableStreamDefaultReader } from "node:stream/web"
import type { fetch as undiciFetch } from "undici"
import { forwardHeaders } from "./daemon-headers.ts"

/** 已保存的额度用尽响应。换号失败时原样返回给调用方。 */
export type BufferedUpstream = {
  status: number
  headers: Record<string, string>
  body: Buffer
}

/** 保证在客户端仍可写时返回 JSON 错误；响应已经开始写出时改为断开连接。 */
export function writeErrorResponse(response: ServerResponse, status: number, error: string): void {
  response.on("error", () => undefined)
  if (response.writableEnded || response.destroyed) return
  if (response.headersSent) {
    response.destroy()
    return
  }
  try {
    response.writeHead(status, { "content-type": "application/json" })
    response.end(JSON.stringify({ error }))
  } catch {
    // writeHead throws ERR_STREAM_DESTROYED once the socket is gone.
  }
}

/** 保证保存这次额度用尽响应；调用方已经断开时返回 null。读取正文失败时按上游状态结束响应。 */
export async function takeQuotaResponse(
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

/** 保证按保存的状态、头和正文结束调用方响应；已经写出的响应不再改动。 */
export function writeBuffered(response: ServerResponse, buffered: BufferedUpstream): void {
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

/** 保证把上游状态、头和正文转发给调用方；客户端断开时停止读取并取消上游正文。 */
export async function writeUpstream(
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
