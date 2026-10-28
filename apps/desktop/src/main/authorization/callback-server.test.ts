// 负责验证真实回环 HTTP 按主进程结果呈现成功、取消或失败，并保留安全响应头。
import { describe, expect, it } from "vitest"
import { createCallbackServer } from "./callback-server"
import { AuthorizationService } from "./service"
import { ProfileVault } from "../testing/profile-fixture"

describe("createCallbackServer", () => {
  it("accepts the callback path on loopback and returns a completion page", async () => {
    let received = ""
    const server = await createCallbackServer(async (url) => {
      received = url
      return { status: "completed" }
    })

    const response = await fetch(`${server.redirectUri}?code=abc&state=state`)
    const body = await response.text()
    await server.close()

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/html")
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'")
    expect(body).toContain("授权完成")
    expect(body).toContain("PigClaude")
    expect(body).not.toContain("code=abc")
    expect(received).toContain("code=abc")
    expect(new URL(server.redirectUri).hostname).toBe("127.0.0.1")
  })

  it("rejects paths outside the callback endpoint", async () => {
    const server = await createCallbackServer(async () => ({ status: "completed" }))
    const response = await fetch(server.redirectUri.replace("/oauth/callback", "/other"))
    await server.close()

    expect(response.status).toBe(404)
  })

  it("does not report success when the authorization service resolves a denied callback", async () => {
    const service = new AuthorizationService({
      authOrigin: "https://auth.example.test",
      vault: new ProfileVault(),
      exchangeCode: async () => {
        throw new Error("cancelled authorization must not exchange")
      },
    })
    let result = ""
    const server = await createCallbackServer(async (url) => {
      const event = await service.handleCallback(url)
      result = event.status
      return event
    })
    try {
      const started = await service.start(
        { purpose: "pigclaude-login", mode: "login" },
        server.redirectUri,
      )
      const state = new URL(started.authorizationUrl).searchParams.get("state")
      const response = await fetch(`${server.redirectUri}?error=access_denied&state=${state}`)
      const body = await response.text()
      expect(result).toBe("denied")
      expect(body).toContain("授权未完成")
      expect(body).not.toContain("授权完成")
      expect(body).not.toContain("即可继续使用")
    } finally {
      await server.close()
    }
  })

  it.each(["cancelled", "expired", "state-mismatch", "exchange-error", "committing"] as const)(
    "keeps a resolved %s result on the non-success page without leaking details",
    async (status) => {
      const server = await createCallbackServer(async () => ({
        status,
        error: "synthetic-private-exchange-details",
      }))
      try {
        const response = await fetch(
          `${server.redirectUri}?code=synthetic-code&state=synthetic-state`,
        )
        const body = await response.text()
        expect(body).toContain(status === "cancelled" ? "授权已取消" : "授权未完成")
        expect(body).not.toContain('class="status success"')
        expect(body).not.toContain("synthetic-code")
        expect(body).not.toContain("synthetic-state")
        expect(body).not.toContain("synthetic-private-exchange-details")
        expect(response.headers.get("cache-control")).toBe("no-store")
      } finally {
        await server.close()
      }
    },
  )

  it("does not infer completed authorization from a code when the app has no result yet", async () => {
    const server = await createCallbackServer(async () => null)
    try {
      const response = await fetch(`${server.redirectUri}?code=synthetic-code`)
      expect(await response.text()).toContain("授权未完成")
    } finally {
      await server.close()
    }
  })

  it("returns a generic failure page when callback processing throws", async () => {
    const server = await createCallbackServer(async () => {
      throw new Error("synthetic-private-storage-details")
    })
    try {
      const response = await fetch(`${server.redirectUri}?code=synthetic-code`)
      const body = await response.text()
      expect(response.status).toBe(500)
      expect(body).toContain("授权未完成")
      expect(body).not.toContain("授权完成")
      expect(body).not.toContain("synthetic-private-storage-details")
    } finally {
      await server.close()
    }
  })
})
