// 验证账号授权的令牌交换和资料请求直接使用同一上游代理，并在代理拒绝时不直连。

import { createServer, type Server } from "node:http"
import { connect } from "node:net"
import type { Duplex } from "node:stream"
import { describe, expect, it } from "vitest"
import type { ClaudeAccountServiceDeps } from "./account-service"
import { createHarness, fingerprint, type Harness } from "./account-service-test-fixtures"
import { SubscriptionOAuth } from "./subscription-oauth"

type Fixture = {
  proxyUrl: string
  tokenUrl: string
  profileUrl: string
  proxyAuthorizations: Array<string | undefined>
  targetRequests: Array<{ path: string | undefined; proxyAuthorization: string | undefined }>
  targetConnections: () => number
  close: () => Promise<void>
}

async function startFixture(
  behavior: "accept" | "reject" | "disconnect" | "reject-profile" = "accept",
): Promise<Fixture> {
  const sockets = new Set<Duplex>()
  const track = (socket: Duplex): void => {
    sockets.add(socket)
    socket.once("close", () => sockets.delete(socket))
    socket.on("error", () => undefined)
  }
  const targetRequests: Fixture["targetRequests"] = []
  let targetConnections = 0
  const target = createServer((request, response) => {
    targetRequests.push({
      path: request.url,
      proxyAuthorization: request.headers["proxy-authorization"],
    })
    request.resume()
    request.once("end", () => {
      const body =
        request.url === "/token"
          ? { access_token: "synthetic-access", refresh_token: "synthetic-refresh", expires_in: 60 }
          : { account: { uuid: "synthetic-account", email: "synthetic@example.test" } }
      response.writeHead(200, { "content-type": "application/json", connection: "close" })
      response.end(JSON.stringify(body))
    })
  })
  target.on("connection", (socket) => {
    targetConnections += 1
    track(socket)
  })
  const targetPort = await listen(target)
  const proxyAuthorizations: Fixture["proxyAuthorizations"] = []
  const proxy = createServer()
  proxy.on("connection", track)
  proxy.on("connect", (request, downstream, head) => {
    proxyAuthorizations.push(request.headers["proxy-authorization"])
    if (behavior === "disconnect") {
      downstream.destroy()
      return
    }
    if (
      behavior === "reject" ||
      (behavior === "reject-profile" && proxyAuthorizations.length > 1) ||
      request.url !== `127.0.0.1:${targetPort}`
    ) {
      downstream.end(
        'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="fixture"\r\nConnection: close\r\n\r\n',
      )
      return
    }
    const upstream = connect(targetPort, "127.0.0.1")
    track(upstream)
    upstream.once("connect", () => {
      downstream.write("HTTP/1.1 200 Connection Established\r\n\r\n")
      if (head.length !== 0) upstream.write(head)
      downstream.pipe(upstream)
      upstream.pipe(downstream)
    })
    upstream.once("error", () => downstream.destroy())
  })
  let proxyPort: number
  try {
    proxyPort = await listen(proxy)
  } catch (error) {
    await closeServer(target, sockets)
    throw error
  }
  return {
    proxyUrl: `http://${encodeURIComponent("合成用户")}:${encodeURIComponent("密 码:@")}@127.0.0.1:${proxyPort}`,
    tokenUrl: `http://127.0.0.1:${targetPort}/token`,
    profileUrl: `http://127.0.0.1:${targetPort}/profile`,
    proxyAuthorizations,
    targetRequests,
    targetConnections: () => targetConnections,
    close: async () => {
      await Promise.all([closeServer(proxy, sockets), closeServer(target, sockets)])
    },
  }
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("夹具未监听")
  return address.port
}

async function closeServer(server: Server, sockets: Set<Duplex>): Promise<void> {
  for (const socket of sockets) socket.destroy()
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}

function createOAuth(fixture: Fixture): ClaudeAccountServiceDeps["oauth"] {
  const client = new SubscriptionOAuth({
    tokenUrl: fixture.tokenUrl,
    profileUrl: fixture.profileUrl,
    timeoutMs: 3_000,
  })
  return {
    buildAuthorizeUrl: () => "https://synthetic.invalid/authorize",
    startCallback: async () => ({
      redirectUri: "http://localhost:1234/callback",
      waitForCode: async () => "synthetic-code",
      close: async () => undefined,
    }),
    exchangeCode: (input) => client.exchangeCode(input),
    readProfile: (input) => client.readProfile(input),
  }
}

describe("Claude 授权直接连接上游代理", () => {
  it("令牌交换和资料请求均经过带凭据的上游，而不使用代理桥", async () => {
    const fixture = await startFixture()
    let harness: Harness | undefined
    try {
      harness = await createHarness({
        oauth: createOAuth(fixture),
        bridgeUrl: "http://127.0.0.1:1",
      })
      await harness.store.saveProxy({
        schemaVersion: 1,
        id: "p1",
        name: "合成代理",
        url: fixture.proxyUrl,
        lastTest: null,
      })
      const result = await harness.service.authorize({
        displayName: "合成账号",
        proxyId: "p1",
        fingerprint,
      })
      const basic = `Basic ${Buffer.from("合成用户:密 码:@", "utf8").toString("base64")}`
      expect(result.email).toBe("synthetic@example.test")
      expect(fixture.proxyAuthorizations).toEqual([basic, basic])
      expect(fixture.targetRequests).toEqual([
        { path: "/token", proxyAuthorization: undefined },
        { path: "/profile", proxyAuthorization: undefined },
      ])
      expect(harness.egressCalls[0]?.upstreamProxyUrl).toBe(fixture.proxyUrl)
      expect(harness.bridgeClosed()).toBe(true)
    } finally {
      try {
        await fixture.close()
      } finally {
        await harness?.cleanup()
      }
    }
  })

  it.each(["reject", "disconnect"] as const)(
    "上游代理 %s 时不连接目标，也不保存账号",
    async (behavior) => {
      const fixture = await startFixture(behavior)
      let harness: Harness | undefined
      try {
        harness = await createHarness({ oauth: createOAuth(fixture) })
        await harness.store.saveProxy({
          schemaVersion: 1,
          id: "p1",
          name: "合成代理",
          url: fixture.proxyUrl,
          lastTest: null,
        })
        await expect(
          harness.service.authorize({ displayName: "合成账号", proxyId: "p1", fingerprint }),
        ).rejects.toMatchObject({ code: "OAUTH_EXCHANGE_FAILED" })
        expect(fixture.proxyAuthorizations.length).toBeGreaterThan(0)
        expect(fixture.targetConnections()).toBe(0)
        expect(fixture.targetRequests).toEqual([])
        expect(await harness.store.getAccount("acc-1")).toBeNull()
        expect(harness.bridgeClosed()).toBe(true)
      } finally {
        try {
          await fixture.close()
        } finally {
          await harness?.cleanup()
        }
      }
    },
  )

  it("令牌交换后代理拒绝 profile 时不会直连，保留资料可选的既有合同", async () => {
    const fixture = await startFixture("reject-profile")
    let harness: Harness | undefined
    try {
      harness = await createHarness({ oauth: createOAuth(fixture) })
      await harness.store.saveProxy({
        schemaVersion: 1,
        id: "p1",
        name: "合成代理",
        url: fixture.proxyUrl,
        lastTest: null,
      })
      const result = await harness.service.authorize({
        displayName: "合成账号",
        proxyId: "p1",
        fingerprint,
      })
      expect(result.email).toBeNull()
      expect(fixture.proxyAuthorizations.length).toBeGreaterThan(1)
      expect(fixture.targetConnections()).toBe(1)
      expect(fixture.targetRequests.map((request) => request.path)).toEqual(["/token"])
      expect((await harness.store.getAccount("acc-1"))?.credential?.accessToken).toBe(
        "synthetic-access",
      )
    } finally {
      try {
        await fixture.close()
      } finally {
        await harness?.cleanup()
      }
    }
  })

  it("没有绑定代理时仍使用系统网络", async () => {
    const fixture = await startFixture()
    let harness: Harness | undefined
    try {
      harness = await createHarness({ oauth: createOAuth(fixture) })
      const result = await harness.service.authorize({
        displayName: "合成账号",
        proxyId: null,
        fingerprint,
      })
      expect(result.email).toBe("synthetic@example.test")
      expect(fixture.proxyAuthorizations).toEqual([])
      expect(fixture.targetRequests.map((request) => request.path)).toEqual(["/token", "/profile"])
    } finally {
      try {
        await fixture.close()
      } finally {
        await harness?.cleanup()
      }
    }
  })
})
