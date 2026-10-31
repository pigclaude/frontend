// 验证桌面代理测试和凭据刷新对单字段代理认证使用同一上游连接语义。

import { mkdtemp, rm } from "node:fs/promises"
import { createServer } from "node:http"
import type { Socket } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AccountRecord } from "@pigclaude/local-store"
import { LocalStore } from "@pigclaude/local-store"
import { fetch as undiciFetch } from "undici"
import { describe, expect, it } from "vitest"
import { CredentialRefresher } from "./credential-refresher"
import { ProxyService } from "./proxy-service"

const now = Date.parse("2026-10-31T00:00:00.000Z")
const responseBody = "ip=198.51.100.42\n"

async function startProxy(): Promise<{
  port: number
  authorizations: Array<string | undefined>
  close: () => Promise<void>
}> {
  const server = createServer()
  const sockets = new Set<Socket>()
  const authorizations: Array<string | undefined> = []
  server.on("connection", (socket) => {
    sockets.add(socket)
    socket.once("close", () => sockets.delete(socket))
  })
  server.on("connect", (request, socket) => {
    authorizations.push(request.headers["proxy-authorization"])
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n")
    socket.once("data", () => {
      socket.end(
        `HTTP/1.1 200 OK\r\nContent-Length: ${Buffer.byteLength(responseBody)}\r\nConnection: close\r\n\r\n${responseBody}`,
      )
    })
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
    close: async () => {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    },
  }
}

function account(): AccountRecord {
  return {
    schemaVersion: 3,
    id: "account",
    displayName: "测试账号",
    enabled: true,
    credential: {
      schemaVersion: 1,
      accessToken: "old-access",
      refreshToken: "old-refresh",
      expiresAt: now + 1_000,
      scopes: ["user:inference"],
      accountUuid: "synthetic-id",
      email: "test@example.invalid",
      organizationUuid: "synthetic-org",
      subscriptionType: "max",
      rateLimitTier: null,
    },
    needsReauth: false,
    proxyId: "proxy",
    fingerprint: {
      seed: "123456",
      brand: "Chrome",
      platform: "macos",
      lang: "en-US",
      timezone: "America/Los_Angeles",
      canvasNoise: "1",
      clientRectsNoise: "1",
    },
    browserProfileDir: "/unused-synthetic-profile",
    exhaustedUntil: null,
    createdAt: "2026-10-31T00:00:00.000Z",
    updatedAt: "2026-10-31T00:00:00.000Z",
  }
}

describe("桌面代理认证", () => {
  it.each([
    { credentials: "name@", decoded: "name:" },
    { credentials: ":secret@", decoded: ":secret" },
  ])("代理测试和凭据刷新均发送同一 Basic 认证", async ({ credentials, decoded }) => {
    const dir = await mkdtemp(join(tmpdir(), "pigclaude-proxy-auth-"))
    let proxy: Awaited<ReturnType<typeof startProxy>> | undefined
    try {
      proxy = await startProxy()
      const store = new LocalStore(dir)
      await store.saveProxy({
        schemaVersion: 1,
        id: "proxy",
        name: "synthetic",
        url: `http://${credentials}127.0.0.1:${proxy.port}`,
        lastTest: null,
      })
      const existing = account()
      await store.saveAccount(existing)
      const service = new ProxyService({
        store,
        now: () => now,
        checkUrl: "http://unresolvable.invalid/check",
      })
      const result = await service.test("proxy")
      expect(result.lastTest).toMatchObject({ ok: true, ip: "198.51.100.42" })
      expect(result.url).not.toContain("secret")

      const refresher = new CredentialRefresher({
        store,
        now: () => now,
        oauth: {
          refresh: async ({ dispatcher }) => {
            expect(dispatcher).toBeDefined()
            const response = await undiciFetch("http://unresolvable.invalid/refresh", {
              dispatcher,
              signal: AbortSignal.timeout(3_000),
            })
            expect(response.status).toBe(200)
            await response.text()
            return {
              accessToken: "new-access",
              refreshToken: "new-refresh",
              expiresAt: now + 300_000,
              scopes: ["user:inference"],
            }
          },
        },
      })
      expect((await refresher.refresh(existing)).credential?.accessToken).toBe("new-access")
      const expected = `Basic ${Buffer.from(decoded, "utf8").toString("base64")}`
      expect(proxy.authorizations).toEqual([expected, expected])
    } finally {
      try {
        await proxy?.close()
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    }
  })
})
