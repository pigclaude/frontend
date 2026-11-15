// 使用合成 HTTPS 服务和受限回环代理检验能力插件的许可、重定向与出口更新。

import { readFile } from "node:fs/promises"
import { createServer } from "node:http"
import { createServer as createHttpsServer } from "node:https"
import { connect, type AddressInfo, type Socket } from "node:net"
import type { Duplex } from "node:stream"
import { getCACertificates, setDefaultCACertificates } from "node:tls"
import { expect, it } from "vitest"
import { createPluginSandboxNetwork } from "./plugin-network"

const scope = new AbortController().signal
const domains = {
  declaredDomains: ["localhost", "unconfirmed.test"],
  approvedDomains: ["LOCALHOST."],
}

it("只转发用户确认且声明的 HTTPS 域，检查每一跳的重定向", async () => {
  const fixture = await loopback()
  try {
    const network = await createPluginSandboxNetwork(domains, async () => null)
    expect(network.domains).toEqual(["localhost"])
    expect(network.permits("https://unconfirmed.test")).toBe(false)
    expect(network.permits("https://host.anthropic.com")).toBe(false)
    expect(
      (await network.forward(new Request(fixture.origin.replace("https:", "http:")), scope)).type,
    ).toBe("error")
    expect(
      (await network.forward(new Request(fixture.origin.replace("localhost", "127.0.0.1")), scope))
        .type,
    ).toBe("error")
    expect(fixture.requests).toHaveLength(0)

    const first = await network.forward(new Request(fixture.origin + "/redirect"), scope)
    expect(first.status).toBe(302)
    expect(fixture.requests.map(({ path }) => path)).toEqual(["/redirect"])
    const follow = first.headers.get("location")
    expect(follow).toBe(fixture.origin + "/ok")
    const accepted = await network.forward(new Request(follow!), scope)
    expect(await accepted.text()).toBe("synthetic endpoint")
    expect(accepted.headers.has("set-cookie")).toBe(false)

    const denied = await network.forward(new Request(fixture.origin + "/blocked-redirect"), scope)
    expect(denied.type).toBe("error")
    expect(fixture.requests.map(({ path }) => path)).toEqual([
      "/redirect",
      "/ok",
      "/blocked-redirect",
    ])
  } finally {
    await fixture.close()
  }
})

it("代理承载请求，代理故障和出口变化都不会回退到系统网络", async () => {
  const fixture = await loopback()
  try {
    const explicit = "http://fixture-user:fixture-password@127.0.0.1:" + fixture.proxyPort
    let route: string | null = explicit
    const network = await createPluginSandboxNetwork(domains, async () => route)
    const direct = await createPluginSandboxNetwork(domains, async () => null)
    expect(network.egressId).not.toBe(direct.egressId)
    expect(JSON.stringify(network)).not.toContain("fixture-password")

    const response = await network.forward(
      new Request(fixture.origin + "/ok", {
        method: "POST",
        headers: { "content-type": "text/plain", cookie: "fixture=ignored" },
        body: "synthetic body",
      }),
      scope,
    )
    expect(await response.text()).toBe("synthetic body")
    expect(fixture.tunnels).toEqual(["localhost:" + fixture.httpsPort])
    expect(fixture.requests[0]?.cookie).toBeUndefined()
    expect(fixture.requests[0]?.proxyAuth).toBeUndefined()

    await fixture.closeProxy()
    const unavailable = await network.forward(new Request(fixture.origin + "/ok"), scope)
    expect(unavailable.type).toBe("error")
    expect(fixture.requests).toHaveLength(1)
    route = null
    expect((await network.forward(new Request(fixture.origin + "/ok"), scope)).type).toBe("error")
    expect(fixture.requests).toHaveLength(1)
    const system = await direct.forward(new Request(fixture.origin + "/ok"), scope)
    expect(await system.text()).toBe("synthetic endpoint")
    expect(fixture.requests).toHaveLength(2)
  } finally {
    await fixture.close()
  }
})

async function loopback() {
  const cert = await readFile(
    new URL(
      "../../../../../packages/login-gate/src/test-fixtures/localhost-synthetic-cert.pem",
      import.meta.url,
    ),
    "utf8",
  )
  const key = await readFile(
    new URL(
      "../../../../../packages/login-gate/src/test-fixtures/localhost-synthetic-key.pem",
      import.meta.url,
    ),
    "utf8",
  )
  const previous = getCACertificates("default")
  setDefaultCACertificates([...previous, cert])
  const requests: { path: string; cookie: string | undefined; proxyAuth: string | undefined }[] = []
  const tls = createHttpsServer({ cert, key }, (request, response) => {
    const path = request.url ?? ""
    requests.push({
      path,
      cookie: request.headers.cookie,
      proxyAuth: request.headers["proxy-authorization"],
    })
    if (path === "/redirect" || path === "/blocked-redirect") {
      response
        .writeHead(302, {
          location:
            path === "/redirect" ? "/ok" : "https://127.0.0.1:" + httpsPort + "/must-not-run",
        })
        .end()
      return
    }
    let data = ""
    request.setEncoding("utf8")
    request.on("data", (chunk: string) => {
      data += chunk
    })
    request.on("end", () => {
      response.writeHead(200, { "content-type": "text/plain", "set-cookie": "fixture=private" })
      response.end(data || "synthetic endpoint")
    })
  })
  await new Promise<void>((resolve) => tls.listen(0, "127.0.0.1", resolve))
  const httpsPort = (tls.address() as AddressInfo).port
  const origin = "https://localhost:" + httpsPort
  const tunnels: string[] = []
  const sockets = new Set<Duplex | Socket>()
  const proxy = createServer((_request, response) => response.writeHead(502).end())
  proxy.on("connect", (request, socket, head) => {
    const authority = "localhost:" + httpsPort
    if (request.url !== authority) return socket.end("HTTP/1.1 403 Forbidden\r\n\r\n")
    tunnels.push(authority)
    const destination = connect(httpsPort, "127.0.0.1", () => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n")
      if (head.length > 0) destination.write(head)
      socket.pipe(destination).pipe(socket)
    })
    sockets.add(socket)
    sockets.add(destination)
    socket.on("error", () => destination.destroy())
    destination.on("error", () => socket.destroy())
  })
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve))
  const proxyPort = (proxy.address() as AddressInfo).port
  const closeProxy = async () => {
    for (const socket of sockets) socket.destroy()
    await new Promise<void>((resolve) => proxy.close(() => resolve()))
  }
  return {
    origin,
    httpsPort,
    proxyPort,
    requests,
    tunnels,
    closeProxy,
    async close() {
      await closeProxy()
      tls.closeAllConnections()
      await new Promise<void>((resolve) => tls.close(() => resolve()))
      setDefaultCACertificates(previous)
    },
  }
}
