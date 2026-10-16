// 本机 daemon 测试。消息请求换成号池凭据，其它路径保留调用方凭据，代理不可用时关闭失败。

import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { createServer, type IncomingMessage, type Server } from "node:http"
import { createServer as createHttpsServer } from "node:https"
import { connect as connectTcp, type Socket } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { getCACertificates, setDefaultCACertificates } from "node:tls"
import { describe, expect, it } from "vitest"
import { LocalDaemon } from "./daemon.ts"

const upstreamHost = "api.anthropic.com:443"

describe("LocalDaemon", () => {
  it("replaces authorization only for message requests and fails closed when the proxy is down", async () => {
    const seen: string[] = []
    const daemon = new LocalDaemon({
      port: 0,
      choose: () => ({ id: "a", authorization: "pool-token", proxyUrl: "http://127.0.0.1:1" }),
    })
    await daemon.start()
    try {
      const response = await fetch(`http://127.0.0.1:${daemon.port}/v1/messages`, {
        method: "POST",
        headers: { authorization: "Bearer from-claude", "content-type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
      })
      expect(response.status).toBe(503)
      expect(await response.json()).toEqual({ error: "proxy_unavailable" })
      expect(seen).toEqual([])
    } finally {
      await daemon.stop()
    }
  })

  it("sends the pool credential only on message posts", async () => {
    const seen: Array<{ path: string; authorization: string | undefined }> = []
    const proxy = await startRecordingProxy(seen)
    const daemon = new LocalDaemon({
      port: 0,
      choose: (attempt) => {
        expect(attempt).toEqual({ rejectedIds: [] })
        return { id: "a", authorization: "pool-token", proxyUrl: proxy.url }
      },
    })
    await daemon.start()
    try {
      await fetch(`http://127.0.0.1:${daemon.port}/v1/messages`, {
        method: "POST",
        headers: { authorization: "Bearer from-claude" },
        body: "{}",
      })
      await fetch(`http://127.0.0.1:${daemon.port}/v1/models`, {
        headers: { authorization: "Bearer from-claude" },
      })
      expect(seen).toEqual([
        { path: "/v1/messages", authorization: "Bearer pool-token" },
        { path: "/v1/models", authorization: "Bearer from-claude" },
      ])
    } finally {
      try {
        await daemon.stop()
      } finally {
        await proxy.stop()
      }
    }
  })

  it("returns proxy_unavailable when choose returns null", async () => {
    const daemon = new LocalDaemon({
      port: 0,
      choose: () => null,
    })
    await daemon.start()
    try {
      const response = await fetch(`http://127.0.0.1:${daemon.port}/v1/models`)
      expect(response.status).toBe(503)
      expect(await response.json()).toEqual({ error: "proxy_unavailable" })
    } finally {
      await daemon.stop()
    }
  })
})

// 记录 CONNECT 隧道里的 HTTPS 请求。undici ProxyAgent 不把路径放在代理的请求行上。
function startRecordingProxy(
  seen: Array<{ path: string; authorization: string | undefined }>,
): Promise<{ url: string; stop: () => Promise<void> }> {
  const material = makeCertificate()
  const previous = getCACertificates("default")
  setDefaultCACertificates([...previous, material.ca])
  const upstream = createHttpsServer(
    { cert: material.cert, key: material.key },
    (request, response) => {
      seen.push({
        path: request.url ?? "",
        authorization: authorizationHeader(request),
      })
      request.resume()
      response.writeHead(200, { connection: "close" })
      response.end("ok")
    },
  )
  const proxy = createServer()
  proxy.on("connect", (request, clientSocket, head) => {
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

function tunnel(clientSocket: Socket, head: Buffer, upstream: Server): void {
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

function authorizationHeader(request: IncomingMessage): string | undefined {
  const value = request.headers.authorization
  return Array.isArray(value) ? value[0] : value
}

function makeCertificate(): { cert: string; key: string; ca: string } {
  const dir = mkdtempSync(join(tmpdir(), "pigclaude-daemon-"))
  const caKey = join(dir, "ca.key")
  const caPem = join(dir, "ca.pem")
  const leafKey = join(dir, "leaf.key")
  const csr = join(dir, "leaf.csr")
  const leafPem = join(dir, "leaf.pem")
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
      "-copy_extensions",
      "copy",
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
