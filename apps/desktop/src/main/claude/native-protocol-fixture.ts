// 为真实 CLI 提供本机合成记录链路，经过生产 daemon 与独占代理，但不向真实模型发送消息。

import {
  createServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
} from "node:http"
import { connect } from "node:net"
import type { Duplex } from "node:stream"
import { randomUUID } from "node:crypto"
import { LocalDaemon } from "@pigclaude/daemon"

/** 本机观察端保存的合成消息，只在内存比较，不进入报告或导出。 */
export type NativeProtocolRequest = { headers: IncomingHttpHeaders; body: Buffer }

/** 真实 native CLI 的本机合成记录入口与所有资源的回收操作。 */
export type NativeProtocolFixture = {
  url: string
  sessionToken: string
  incoming: () => NativeProtocolRequest | undefined
  forwarded: Promise<NativeProtocolRequest>
  stop: () => Promise<void>
}

/** 建立 CLI → 记录端 → 实际 daemon → 独占代理 → 本机假端点，不使用用户账号或远端模型。 */
export async function createNativeProtocolFixture(): Promise<NativeProtocolFixture> {
  const servers: Server[] = []
  const sockets = new Set<Duplex>()
  const sessionToken = randomUUID()
  let incoming: NativeProtocolRequest | undefined
  let complete: (value: NativeProtocolRequest) => void = () => undefined
  const forwarded = new Promise<NativeProtocolRequest>((resolve) => {
    complete = resolve
  })
  const origin = createServer((request, response) => {
    void body(request).then(
      (data) => {
        if (
          request.method === "POST" &&
          new URL(request.url ?? "/", "http://127.0.0.1").pathname === "/v1/messages"
        )
          complete({ headers: request.headers, body: data })
        response.writeHead(400, { "content-type": "application/json" })
        response.end(
          JSON.stringify({
            type: "error",
            error: {
              type: "invalid_request_error",
              message: "Owned native diagnostic; no model request forwarded",
            },
          }),
        )
      },
      () => response.destroy(),
    )
  })
  servers.push(origin)
  let daemon: LocalDaemon | undefined
  let stopped: Promise<void> | undefined
  const stop = (): Promise<void> => {
    stopped ??= (async () => {
      for (const socket of sockets) socket.destroy()
      const results = await Promise.allSettled([
        daemon?.stop(),
        ...servers.map(async (server) => {
          server.closeAllConnections()
          if (server.listening)
            await new Promise<void>((resolve, reject) =>
              server.close((error) => (error ? reject(error) : resolve())),
            )
        }),
      ])
      const errors = results
        .filter((result) => result.status === "rejected")
        .map((result) => result.reason)
      if (errors.length) throw new AggregateError(errors, "本机协议诊断资源未确认回收")
    })().catch((error: unknown) => {
      stopped = undefined
      throw error
    })
    return stopped
  }
  try {
    const originPort = await listen(origin)
    const proxy = createServer()
    servers.push(proxy)
    proxy.on("connect", (request, client, head) => {
      if (request.url !== `127.0.0.1:${originPort}`) {
        client.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n")
        return
      }
      sockets.add(client)
      client.once("close", () => sockets.delete(client))
      const target = connect(originPort, "127.0.0.1", () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n")
        if (head.length) target.write(head)
        client.pipe(target).pipe(client)
      })
      sockets.add(target)
      target.once("close", () => sockets.delete(target))
      target.on("error", () => client.destroy())
      client.on("error", () => target.destroy())
    })
    const proxyPort = await listen(proxy)
    const options = {
      port: 0,
      sessionToken,
      choose: () => ({
        id: "native-diagnostic",
        authorization: "pigclaude-diagnostic-upstream",
        proxyUrl: `http://127.0.0.1:${proxyPort}`,
      }),
      runAuthorized: async <T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> =>
        operation(new AbortController().signal),
      upstreamOrigin: new URL(`http://127.0.0.1:${originPort}`),
    }
    daemon = new LocalDaemon(options)
    await daemon.start()
    const targetPort = daemon.port
    const tap = createServer((request, response) => {
      void body(request).then(
        (data) => {
          if (
            request.method === "POST" &&
            new URL(request.url ?? "/", "http://127.0.0.1").pathname === "/v1/messages"
          )
            incoming = { headers: { ...request.headers }, body: data }
          const upstream = httpRequest(
            {
              hostname: "127.0.0.1",
              port: targetPort,
              path: request.url ?? "/",
              method: request.method ?? "GET",
              headers: { ...request.headers, host: `127.0.0.1:${targetPort}` },
            },
            (result) => {
              response.writeHead(result.statusCode ?? 502, result.headers)
              result.pipe(response)
            },
          )
          upstream.on("error", () => response.destroy())
          response.once("close", () => upstream.destroy())
          upstream.end(data)
        },
        () => response.destroy(),
      )
    })
    servers.push(tap)
    const port = await listen(tap)
    return {
      url: `http://127.0.0.1:${port}`,
      sessionToken,
      incoming: () => incoming,
      forwarded,
      stop,
    }
  } catch (error: unknown) {
    try {
      await stop()
    } catch (cleanup: unknown) {
      throw new AggregateError([error, cleanup], "原生协议诊断准备失败且未完成清理")
    }
    throw error
  }
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("本机诊断监听未就绪")
  return address.port
}

async function body(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const value of request) {
    const chunk: Buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value))
    size += chunk.length
    if (size > 1_048_576) throw new Error("合成诊断请求过大")
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}
