// 验证直接上游代理的认证一致性，以及凭据不会进入代理隧道后的目标请求。

import { execFileSync } from "node:child_process"
import { getDefaultResultOrder, setDefaultResultOrder } from "node:dns"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { createServer, type Server } from "node:http"
import { createServer as createHttpsServer } from "node:https"
import { createServer as createTcpServer, type Socket } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { getCACertificates, setDefaultCACertificates } from "node:tls"
import { fetch as undiciFetch } from "undici"
import { describe, expect, it } from "vitest"
import { createProxyAgent } from "./proxy-connection.ts"

type ProxyFixture = {
  port: number
  authorizations: Array<string | undefined>
  tunneledRequests: string[]
  stop: () => Promise<void>
}

async function startProxy(
  allowTunnel: boolean,
  tls?: { key: string; cert: string },
): Promise<ProxyFixture> {
  const server: Server = tls === undefined ? createServer() : createHttpsServer(tls)
  const sockets = new Set<Socket>()
  const authorizations: Array<string | undefined> = []
  const tunneledRequests: string[] = []
  server.on("connection", (socket) => {
    sockets.add(socket)
    socket.on("close", () => sockets.delete(socket))
  })
  server.on("connect", (request, socket) => {
    authorizations.push(request.headers["proxy-authorization"])
    if (!allowTunnel) {
      socket.end(
        'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="test"\r\nConnection: close\r\n\r\n',
      )
      return
    }
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n")
    let pending = Buffer.alloc(0)
    const onData = (data: Buffer): void => {
      if (pending.length + data.length > 16_384) {
        socket.destroy()
        return
      }
      pending = Buffer.concat([pending, data])
      const end = pending.indexOf("\r\n\r\n")
      if (end < 0) return
      socket.off("data", onData)
      tunneledRequests.push(pending.subarray(0, end + 4).toString("utf8"))
      socket.end("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok")
    }
    socket.on("data", onData)
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  if (address === null || typeof address === "string") {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    throw new Error("测试代理未监听")
  }
  return {
    port: address.port,
    authorizations,
    tunneledRequests,
    stop: async () => {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    },
  }
}

function basic(value: string): string {
  return `Basic ${Buffer.from(value, "utf8").toString("base64")}`
}

async function startTarget(): Promise<{
  port: number
  connections: () => number
  stop: () => Promise<void>
}> {
  let connections = 0
  const server = createTcpServer((socket) => {
    connections += 1
    socket.destroy()
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  if (address === null || typeof address === "string") {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    throw new Error("测试目标未监听")
  }
  return {
    port: address.port,
    connections: () => connections,
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}

describe("直接上游代理认证", () => {
  it("拒绝无法解码的凭据，不尝试改走直连", () => {
    expect(() => createProxyAgent("http://%FF@127.0.0.1:1")).toThrow(URIError)
  })

  it.each([
    { name: "无凭据", credentials: "", expected: undefined },
    { name: "仅用户名", credentials: "name@", expected: basic("name:") },
    { name: "仅密码", credentials: ":secret@", expected: basic(":secret") },
    { name: "用户名和密码", credentials: "name:secret@", expected: basic("name:secret") },
    {
      name: "UTF-8 和转义字符",
      credentials: "%E7%94%A8%40%E6%88%B7:%E5%AF%86%20%E7%A0%81@",
      expected: basic("用@户:密 码"),
    },
  ])("代理返回 407 时正确发送 $name，且不回退直连", async ({ credentials, expected }) => {
    const proxy = await startProxy(false)
    try {
      const target = await startTarget()
      try {
        const agent = createProxyAgent(`http://${credentials}127.0.0.1:${proxy.port}`)
        try {
          await expect(
            undiciFetch(`https://127.0.0.1:${target.port}/path`, {
              dispatcher: agent,
              signal: AbortSignal.timeout(3_000),
            }),
          ).rejects.toThrow()
          expect(proxy.authorizations).toEqual([expected])
        } finally {
          await agent.close()
        }
        await new Promise<void>((resolve) => setImmediate(resolve))
        expect(target.connections()).toBe(0)
      } finally {
        await target.stop()
      }
    } finally {
      await proxy.stop()
    }
  })

  it("认证头只发给代理，不进入 CONNECT 隧道内的目标请求", async () => {
    const proxy = await startProxy(true)
    try {
      const agent = createProxyAgent(`http://name@127.0.0.1:${proxy.port}`)
      try {
        const response = await undiciFetch("http://unresolvable.invalid/target", {
          dispatcher: agent,
          signal: AbortSignal.timeout(3_000),
        })
        expect(await response.text()).toBe("ok")
        expect(proxy.authorizations).toEqual([basic("name:")])
        expect(proxy.tunneledRequests).toHaveLength(1)
        expect(proxy.tunneledRequests[0]?.toLowerCase()).not.toContain("proxy-authorization:")
      } finally {
        await agent.close()
      }
    } finally {
      await proxy.stop()
    }
  })

  it("HTTPS 代理证书可信后才发送 Basic 认证", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pigclaude-proxy-tls-"))
    try {
      const keyPath = join(dir, "test.key")
      const certPath = join(dir, "test.pem")
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
          "/CN=localhost",
          "-addext",
          "subjectAltName=DNS:localhost",
          "-addext",
          "basicConstraints=critical,CA:TRUE",
        ],
        { stdio: "ignore" },
      )
      const key = await readFile(keyPath, "utf8")
      const cert = await readFile(certPath, "utf8")
      const proxy = await startProxy(true, { key, cert })
      try {
        const previous = getCACertificates("default")
        const previousOrder = getDefaultResultOrder()
        try {
          setDefaultResultOrder("ipv4first")
          const proxyUrl = `https://name@localhost:${proxy.port}`
          const untrusted = createProxyAgent(proxyUrl)
          try {
            await expect(
              undiciFetch("http://unresolvable.invalid/target", {
                dispatcher: untrusted,
                signal: AbortSignal.timeout(3_000),
              }),
            ).rejects.toMatchObject({ cause: { code: "DEPTH_ZERO_SELF_SIGNED_CERT" } })
            expect(proxy.authorizations).toEqual([])
          } finally {
            await untrusted.close()
          }
          setDefaultCACertificates([...previous, cert])
          const trusted = createProxyAgent(proxyUrl)
          try {
            const response = await undiciFetch("http://unresolvable.invalid/target", {
              dispatcher: trusted,
              signal: AbortSignal.timeout(3_000),
            })
            expect(await response.text()).toBe("ok")
            expect(proxy.authorizations).toEqual([basic("name:")])
            expect(proxy.tunneledRequests).toHaveLength(1)
            expect(proxy.tunneledRequests[0]?.toLowerCase()).not.toContain("proxy-authorization:")
          } finally {
            await trusted.close()
          }
        } finally {
          try {
            setDefaultCACertificates(previous)
          } finally {
            setDefaultResultOrder(previousOrder)
          }
        }
      } finally {
        await proxy.stop()
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
