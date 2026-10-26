// 测试用 HTTPS 代理夹具。记录隧道里的请求，并按脚本返回状态码或分段正文。

import { execFileSync } from "node:child_process"
import { once } from "node:events"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { createServer as createHttpsServer } from "node:https"
import { connect as connectTcp } from "node:net"
import type { Duplex } from "node:stream"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { getCACertificates, setDefaultCACertificates } from "node:tls"
import { gzipSync } from "node:zlib"

const upstreamHost = "api.anthropic.com:443"

type TunnelEvent = "open" | "close"
type RecordingOptions = {
  gzipPlain?: string
  brokenGzip?: boolean
  holdBody?: boolean
  onTunnel?: (event: TunnelEvent) => void
}
type ScriptedReply = {
  status: number
  headers?: Record<string, string>
  body: string
  trickle?: boolean
}
type UpstreamScript = () => ScriptedReply | Promise<ScriptedReply>
type SeenRequest = {
  path: string
  authorization: string | undefined
  session?: string | undefined
  beta?: string | undefined
}

/** 保证记下隧道里的路径和 Authorization，并按选项或脚本响应上游。 */
export function startRecordingProxy(
  seen: SeenRequest[],
  options?: RecordingOptions | UpstreamScript,
): Promise<{ url: string; stop: () => Promise<void> }> {
  const material = makeCertificate()
  const previous = getCACertificates("default")
  setDefaultCACertificates([...previous, material.ca])
  const upstream = createHttpsServer(
    { cert: material.cert, key: material.key },
    (request, response) => {
      void handleProxiedRequest(request, response, seen, options).catch(() => {
        if (!response.headersSent && !response.destroyed) {
          response.writeHead(500, { connection: "close" })
        }
        if (!response.destroyed) response.end()
      })
    },
  )
  const proxy = createServer()
  proxy.on("connect", (request, clientSocket, head) => {
    if (typeof options !== "function") options?.onTunnel?.("open")
    clientSocket.on("close", () => {
      if (typeof options !== "function") options?.onTunnel?.("close")
    })
    if ((request.url ?? "") !== upstreamHost) {
      clientSocket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n")
      return
    }
    tunnel(clientSocket, head, upstream)
  })
  return listen(upstream)
    .then(() => listen(proxy))
    .then((port) => ({
      url: `http://127.0.0.1:${port}`,
      stop: async () => {
        setDefaultCACertificates(previous)
        await closeServer(proxy)
        await closeServer(upstream)
      },
    }))
    .catch(async (error: unknown) => {
      setDefaultCACertificates(previous)
      await closeServer(proxy)
      await closeServer(upstream)
      throw error
    })
}

/** 保证按脚本响应上游。trickle 为 true 时先写前两个字节，50 毫秒后再写剩余字节。 */
export function startScriptedProxy(
  script: UpstreamScript,
): Promise<{ url: string; stop: () => Promise<void> }> {
  return startRecordingProxy([], script)
}

async function handleProxiedRequest(
  request: IncomingMessage,
  response: ServerResponse,
  seen: SeenRequest[],
  options?: RecordingOptions | UpstreamScript,
): Promise<void> {
  seen.push({
    path: request.url ?? "",
    authorization: headerValue(request, "authorization"),
    session: headerValue(request, "x-pigclaude-session"),
    beta: headerValue(request, "anthropic-beta"),
  })
  request.resume()
  if (typeof options === "function") {
    await once(request, "end")
    await writeScripted(response, await options())
    return
  }
  if (options?.gzipPlain !== undefined) {
    const encoded = gzipSync(options.gzipPlain)
    response.writeHead(200, {
      "content-encoding": "gzip",
      "content-length": String(encoded.length),
      connection: "close",
    })
    response.end(encoded)
    return
  }
  if (options?.brokenGzip) {
    response.writeHead(200, { "content-encoding": "gzip", connection: "close" })
    response.end("not-gzip")
    return
  }
  if (options?.holdBody) {
    response.writeHead(200, { "content-type": "text/plain" })
    response.socket?.setNoDelay(true)
    response.write("hello-held")
    response.socket?.uncork()
    return
  }
  response.writeHead(200, { connection: "close" })
  response.end("ok")
}

async function writeScripted(response: ServerResponse, scripted: ScriptedReply): Promise<void> {
  if (scripted.trickle) {
    const headers = scripted.headers ?? { "content-type": "text/plain" }
    response.writeHead(scripted.status, headers)
    response.socket?.setNoDelay(true)
    response.flushHeaders()
    response.write(scripted.body.slice(0, 2))
    response.socket?.uncork()
    await delay(50)
    if (!response.destroyed && !response.writableEnded) response.end(scripted.body.slice(2))
    return
  }
  response.writeHead(scripted.status, { connection: "close", ...scripted.headers })
  response.end(scripted.body)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function tunnel(clientSocket: Duplex, head: Buffer, upstream: Server): void {
  const address = upstream.address()
  if (address === null || typeof address === "string") {
    clientSocket.destroy()
    return
  }
  const upstreamSocket = connectTcp(address.port, "127.0.0.1", () => {
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n")
    if (head.length > 0) upstreamSocket.write(head)
    upstreamSocket.pipe(clientSocket)
    clientSocket.pipe(upstreamSocket)
  })
  const closeBoth = (): void => {
    clientSocket.destroy()
    upstreamSocket.destroy()
  }
  upstreamSocket.on("error", closeBoth)
  clientSocket.on("error", closeBoth)
}

function headerValue(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name]
  return Array.isArray(value) ? value[0] : value
}

function makeCertificate(): { cert: string; key: string; ca: string } {
  const dir = mkdtempSync(join(tmpdir(), "pigclaude-daemon-"))
  const caKey = join(dir, "ca.key")
  const caPem = join(dir, "ca.pem")
  const leafKey = join(dir, "leaf.key")
  const csr = join(dir, "leaf.csr")
  const leafPem = join(dir, "leaf.pem")
  const leafExtensions = join(dir, "leaf.ext")
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-keyout",
      caKey,
      "-out",
      caPem,
      "-days",
      "1",
      "-nodes",
      "-subj",
      "/CN=pigclaude-test-ca",
      "-addext",
      "basicConstraints=critical,CA:TRUE",
    ],
    { stdio: "ignore" },
  )
  writeFileSync(leafExtensions, "subjectAltName=DNS:api.anthropic.com\n", "utf8")
  execFileSync(
    "openssl",
    [
      "req",
      "-newkey",
      "rsa:2048",
      "-keyout",
      leafKey,
      "-out",
      csr,
      "-nodes",
      "-subj",
      "/CN=api.anthropic.com",
      "-addext",
      "subjectAltName=DNS:api.anthropic.com",
    ],
    { stdio: "ignore" },
  )
  execFileSync(
    "openssl",
    [
      "x509",
      "-req",
      "-in",
      csr,
      "-CA",
      caPem,
      "-CAkey",
      caKey,
      "-CAcreateserial",
      "-out",
      leafPem,
      "-days",
      "1",
      "-extfile",
      leafExtensions,
    ],
    { stdio: "ignore" },
  )
  const material = {
    cert: readFileSync(leafPem, "utf8"),
    key: readFileSync(leafKey, "utf8"),
    ca: readFileSync(caPem, "utf8"),
  }
  rmSync(dir, { recursive: true, force: true })
  return material
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      reject(error)
    }
    server.once("error", onError)
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError)
      const address = server.address()
      if (address === null || typeof address === "string") {
        reject(new Error("proxy did not bind a port"))
        return
      }
      resolve(address.port)
    })
  })
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve()
  server.closeAllConnections()
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}
