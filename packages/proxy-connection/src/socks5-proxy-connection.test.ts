// 使用隔离的回环 SOCKS5 夹具验证三条上游路径、认证、代理侧域名与握手取消。

import { execFileSync } from "node:child_process"
import { once } from "node:events"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { createServer as createHttpsServer } from "node:https"
import { createConnection, createServer, type Socket } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { getCACertificates, setDefaultCACertificates } from "node:tls"
import { fetch as undiciFetch } from "undici"
import { expect, it } from "vitest"
import { connectProxyTunnel, createHttpProxyForwarder, createProxyAgent } from "./proxy-connection"

const target = new URL("http://probe.example.test:8080/ping?fixture=1")
const reply = "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok"

async function read(socket: Socket, length: number): Promise<Buffer> {
  while (!socket.destroyed && !socket.readableEnded) {
    const result: unknown = socket.read(length)
    if (Buffer.isBuffer(result)) return result
    await once(socket, "readable", { signal: AbortSignal.timeout(3_000) })
  }
  throw new Error("测试握手被提前关闭")
}

async function startProxy({ stall = false, tlsPort }: { stall?: boolean; tlsPort?: number } = {}) {
  const credentials: Array<[string, string]> = []
  const destinations: Array<[string, number]> = []
  const requests: string[] = []
  const sockets = new Set<Socket>()
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.once("close", () => sockets.delete(socket))
    socket.on("error", () => socket.destroy())
    if (stall) {
      socket.resume()
      return
    }
    void (async () => {
      const greeting = await read(socket, 2)
      const methods = await read(socket, greeting[1]!)
      if (greeting[0] !== 5 || !methods.includes(2)) throw new Error("缺少账号密码认证")
      socket.write(Buffer.from([5, 2]))
      const auth = await read(socket, 2)
      const user = (await read(socket, auth[1]!)).toString("utf8")
      const passLength = (await read(socket, 1))[0]!
      const pass = (await read(socket, passLength)).toString("utf8")
      credentials.push([user, pass])
      socket.write(Buffer.from([1, 0]))
      const connect = await read(socket, 5)
      if (connect[0] !== 5 || connect[1] !== 1 || connect[3] !== 3)
        throw new Error("没有将域名交给上游代理")
      const domain = (await read(socket, connect[4]!)).toString("ascii")
      const port = (await read(socket, 2)).readUInt16BE()
      destinations.push([domain, port])
      if (tlsPort !== undefined) {
        if (domain !== target.hostname || port !== tlsPort) throw new Error("测试目的地不匹配")
        const upstream = createConnection({ host: "127.0.0.1", port: tlsPort })
        upstream.on("error", () => socket.destroy())
        socket.once("close", () => upstream.destroy())
        await once(upstream, "connect")
        socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]))
        socket.pipe(upstream).pipe(socket)
        return
      }
      socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]))
      socket.once("data", (body: Buffer) => {
        requests.push(body.toString("utf8"))
        socket.end(reply)
      })
      socket.resume()
    })().catch(() => socket.destroy())
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const where = server.address()
  if (where === null || typeof where === "string") throw new Error("测试代理未监听")
  return {
    server,
    credentials,
    destinations,
    requests,
    url: "socks5://qa%40user:pass%3Aword@127.0.0.1:" + where.port,
    async close() {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    },
  }
}

it("认证 SOCKS5 后由远端解析域名，覆盖 dispatcher、普通 HTTP 转发和 CONNECT", async () => {
  const proxy = await startProxy()
  const dispatcher = createProxyAgent(proxy.url)
  const forwarder = createHttpProxyForwarder(proxy.url)
  try {
    const response = await undiciFetch(target, { dispatcher, signal: AbortSignal.timeout(5000) })
    expect(await response.text()).toBe("ok")
    const forwarded = await forwarder.request(target, { method: "GET", headers: {} })
    expect(await forwarded.body.text()).toBe("ok")
    const socket = await connectProxyTunnel(proxy.url, target.host, AbortSignal.timeout(5000))
    try {
      const bytes = once(socket, "data", { signal: AbortSignal.timeout(3000) })
      socket.write("GET /raw HTTP/1.1\r\nHost: " + target.host + "\r\n\r\n")
      const [body] = await bytes
      expect(String(body)).toContain("200 OK")
    } finally {
      socket.destroy()
    }
    expect(proxy.credentials).toEqual(Array.from({ length: 3 }, () => ["qa@user", "pass:word"]))
    expect(proxy.destinations).toEqual(
      Array.from({ length: 3 }, () => [target.hostname, Number(target.port)]),
    )
    expect(proxy.requests).toEqual([
      expect.stringContaining("GET /ping?fixture=1 "),
      expect.stringContaining("GET /ping?fixture=1 "),
      expect.stringContaining("GET /raw "),
    ])
    expect(proxy.requests.join("\n")).not.toMatch(/proxy-authorization/i)
  } finally {
    await Promise.allSettled([dispatcher.destroy(), forwarder.close(), proxy.close()])
  }
})

it("经认证 SOCKS5 访问 HTTPS 时校验证书并保留原站域名", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pigclaude-socks5-tls-"))
  const previous = getCACertificates("default")
  try {
    const keyPath = join(directory, "test.key")
    const certPath = join(directory, "test.pem")
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-keyout",
        keyPath,
        "-out",
        certPath,
        "-days",
        "1",
        "-nodes",
        "-subj",
        `/CN=${target.hostname}`,
        "-addext",
        `subjectAltName=DNS:${target.hostname}`,
        "-addext",
        "basicConstraints=critical,CA:TRUE",
      ],
      { stdio: "ignore" },
    )
    const [key, cert] = await Promise.all([readFile(keyPath, "utf8"), readFile(certPath, "utf8")])
    const requests: Array<{ host: string | undefined; proxyAuthorization: string | undefined }> = []
    const server = createHttpsServer({ key, cert }, (request, response) => {
      requests.push({
        host: request.headers.host,
        proxyAuthorization: request.headers["proxy-authorization"],
      })
      response.end("tls ok")
    })
    try {
      server.listen(0, "127.0.0.1")
      await once(server, "listening")
      const where = server.address()
      if (where === null || typeof where === "string") throw new Error("测试 HTTPS 服务未监听")
      const proxy = await startProxy({ tlsPort: where.port })
      const dispatcher = createProxyAgent(proxy.url)
      const url = `https://${target.hostname}:${where.port}/ping`
      try {
        await expect(
          undiciFetch(url, { dispatcher, signal: AbortSignal.timeout(3000) }),
        ).rejects.toMatchObject({ cause: { code: "DEPTH_ZERO_SELF_SIGNED_CERT" } })
        expect(requests).toEqual([])

        setDefaultCACertificates([...previous, cert])
        const response = await undiciFetch(url, { dispatcher, signal: AbortSignal.timeout(3000) })
        expect(await response.text()).toBe("tls ok")
        expect(requests).toEqual([
          { host: `${target.hostname}:${where.port}`, proxyAuthorization: undefined },
        ])
        expect(proxy.destinations).toEqual(
          Array.from({ length: 2 }, () => [target.hostname, where.port]),
        )
        expect(proxy.credentials).toEqual(Array.from({ length: 2 }, () => ["qa@user", "pass:word"]))
      } finally {
        await Promise.allSettled([dispatcher.destroy(), proxy.close()])
      }
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    }
  } finally {
    setDefaultCACertificates(previous)
    await rm(directory, { recursive: true, force: true })
  }
})

it("取消等待中的 SOCKS5 握手会关闭上游 socket", async () => {
  const proxy = await startProxy({ stall: true })
  const abort = new AbortController()
  try {
    const connection = once(proxy.server, "connection", { signal: AbortSignal.timeout(3000) })
    const tunnel = connectProxyTunnel(proxy.url, target.host, abort.signal)
    const result = expect(tunnel).rejects.toMatchObject({ name: "AbortError" })
    const [socket] = await connection
    const closed = once(socket, "close", { signal: AbortSignal.timeout(3000) })
    abort.abort()
    await result
    await closed
  } finally {
    await proxy.close()
  }
})

it("销毁 dispatcher 会关闭仍在握手的 SOCKS5 连接", async () => {
  const proxy = await startProxy({ stall: true })
  const dispatcher = createProxyAgent(proxy.url)
  try {
    const connection = once(proxy.server, "connection", { signal: AbortSignal.timeout(3000) })
    const rejected = expect(undiciFetch(target, { dispatcher })).rejects.toThrow()
    const [socket] = await connection
    const closed = once(socket, "close", { signal: AbortSignal.timeout(2000) })
    await dispatcher.destroy()
    await rejected
    await closed
  } finally {
    await Promise.allSettled([dispatcher.destroy(), proxy.close()])
  }
})
