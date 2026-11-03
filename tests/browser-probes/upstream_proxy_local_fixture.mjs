// 为真实上游浏览器提供只通往本轮回环目标的合成认证代理，不访问外部地址或记录凭据。
import http from "node:http"
import { randomBytes, timingSafeEqual } from "node:crypto"

/** 创建仅允许本轮目标 URL 的回环代理与来源站，返回有限观察值和合成凭据提供器。 */
export async function createLocalProxyFixture() {
  const marker = randomBytes(16).toString("hex")
  const hop = randomBytes(24).toString("hex")
  const credentials = {
    username: "合成用户-" + randomBytes(6).toString("hex"),
    password: "本机测试-" + randomBytes(12).toString("hex"),
  }
  const expected = Buffer.from(
    "Basic " +
      Buffer.from(`${credentials.username}:${credentials.password}`, "utf8").toString("base64"),
  )
  const counts = {
    challenges: 0,
    acceptedCredentials: 0,
    rejectedCredentials: 0,
    forwarded: 0,
    originViaProxy: 0,
    originDirect: 0,
    originAuthorizationSeen: 0,
    sourceChallenges: 0,
    droppedConnections: 0,
  }
  let dropping = false
  const proxySockets = new Set()
  const upstreamRequests = new Set()
  const origin = http.createServer({ maxHeaderSize: 8192 }, (request, response) => {
    response.setHeader("Connection", "close")
    response.setHeader("Cache-Control", "no-store")
    if (request.headers["x-pigclaude-fixture-hop"] === hop) counts.originViaProxy++
    else counts.originDirect++
    if (request.headers.authorization !== undefined) counts.originAuthorizationSeen++
    if (!request.url?.startsWith(`/${marker}/`)) {
      response.writeHead(404).end()
      return
    }
    if (request.url.endsWith("/server-auth")) {
      counts.sourceChallenges++
      response.setHeader("WWW-Authenticate", 'Basic realm="synthetic-origin", charset="UTF-8"')
      response.writeHead(401).end("synthetic origin authentication")
      return
    }
    response.setHeader("Content-Type", "text/html; charset=utf-8")
    response.end(`<!doctype html><pre id="proxy-result">${marker}</pre>`)
  })
  const listen = (server) =>
    new Promise((resolve, reject) => {
      server.once("error", reject)
      server.listen(0, "127.0.0.1", resolve)
    })
  await listen(origin)
  const originPort = origin.address().port
  const proxy = http.createServer({ maxHeaderSize: 8192 }, (request, response) => {
    response.setHeader("Connection", "close")
    if (dropping) {
      counts.droppedConnections++
      request.socket.destroy()
      return
    }
    let url
    try {
      url = new URL(request.url)
    } catch {
      response.writeHead(502).end()
      return
    }
    if (
      request.method !== "GET" ||
      url.protocol !== "http:" ||
      url.hostname !== "127.0.0.1" ||
      Number(url.port) !== originPort ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !url.pathname.startsWith(`/${marker}/`)
    ) {
      response.writeHead(502).end()
      return
    }
    const header = request.headers["proxy-authorization"]
    const candidate = typeof header === "string" ? Buffer.from(header) : Buffer.alloc(0)
    const authenticated =
      candidate.length === expected.length && timingSafeEqual(candidate, expected)
    candidate.fill(0)
    if (!authenticated) {
      counts.challenges++
      if (header !== undefined) counts.rejectedCredentials++
      response.setHeader(
        "Proxy-Authenticate",
        'Basic realm="pigclaude-local-fixture", charset="UTF-8"',
      )
      response.writeHead(407).end()
      return
    }
    counts.acceptedCredentials++
    const headers = { "x-pigclaude-fixture-hop": hop, Connection: "close" }
    // 保留来源站 Authorization 的可观察性，避免代理夹具掩盖错误发送凭据的问题。
    if (typeof request.headers.authorization === "string")
      headers.Authorization = request.headers.authorization
    const upstream = http.request(
      {
        host: "127.0.0.1",
        port: originPort,
        path: url.pathname,
        method: "GET",
        headers,
        agent: false,
      },
      (incoming) => {
        counts.forwarded++
        response.writeHead(incoming.statusCode, incoming.headers)
        incoming.pipe(response)
      },
    )
    upstreamRequests.add(upstream)
    upstream.on("close", () => upstreamRequests.delete(upstream))
    upstream.on("error", () => {
      if (!response.headersSent) response.writeHead(502)
      response.end()
    })
    upstream.end()
  })
  proxy.on("connection", (socket) => {
    proxySockets.add(socket)
    socket.on("error", () => {})
    socket.on("close", () => proxySockets.delete(socket))
    if (dropping) {
      counts.droppedConnections++
      socket.destroy()
    }
  })
  proxy.on("connect", (_request, socket) => socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n"))
  try {
    await listen(proxy)
  } catch (error) {
    await new Promise((resolve) => origin.close(resolve))
    throw error
  }
  return {
    endpoint: `http://127.0.0.1:${proxy.address().port}`,
    targetUrl: `http://127.0.0.1:${originPort}/${marker}/ok`,
    sourceAuthUrl: `http://127.0.0.1:${originPort}/${marker}/server-auth`,
    failureUrl: `http://127.0.0.1:${originPort}/${marker}/after-drop`,
    marker,
    /** 只返回本轮合成凭据，不访问账号库、环境秘密或真实代理。 */
    getCredentials: () => ({ ...credentials }),
    /** 只返回计数，不包含 URL、认证头或凭据。 */
    observations: () => ({ ...counts }),
    /** 保持代理监听端口持有，断开当前连接并丢弃后续连接以模拟代理失效。 */
    failProxy() {
      dropping = true
      for (const request of upstreamRequests) request.destroy()
      for (const socket of proxySockets) socket.destroy()
    },
    /** 仅在调用方已确认浏览器退出后释放本轮服务。 */
    async close() {
      for (const request of upstreamRequests) request.destroy()
      for (const socket of proxySockets) socket.destroy()
      await Promise.all([
        new Promise((resolve) => proxy.close(resolve)),
        new Promise((resolve) => origin.close(resolve)),
      ])
      expected.fill(0)
    },
  }
}
