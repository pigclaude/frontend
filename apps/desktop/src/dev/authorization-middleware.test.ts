// 负责验证授权页 GET 请求会记录会话后继续交给 Vite 渲染，而不是悬挂空白页。
import { createServer, type Server } from "node:http"
import { afterEach, describe, expect, it } from "vitest"
import { createAuthorizationSession } from "../main/authorization/pkce"
import { DevAuthorizationFixture } from "./authorization-fixture"
import { createAuthorizationMiddleware } from "./authorization-middleware"

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve())
        }),
    ),
  )
})

describe("createAuthorizationMiddleware", () => {
  it("delegates the authorization page to the next Vite handler", async () => {
    const fixture = new DevAuthorizationFixture({ now: () => 1_000 })
    const session = createAuthorizationSession({
      request: { purpose: "pigclaude-login", mode: "login" },
      redirectUri: "http://127.0.0.1:43123/oauth/callback",
      now: 1_000,
    })
    const middleware = createAuthorizationMiddleware(fixture)
    const server = createServer((request, response) => {
      middleware(request, response, () => {
        response.statusCode = 200
        response.end("vite page")
      })
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()))
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("server did not start")

    const query = new URLSearchParams({
      session_id: session.sessionId,
      state: session.state,
      code_challenge: session.codeChallenge,
      redirect_uri: session.redirectUri,
      purpose: session.request.purpose,
      mode: session.request.mode,
    })
    const response = await fetch(`http://127.0.0.1:${address.port}/authorize?${query}`)

    expect(response.status).toBe(200)
    expect(await response.text()).toBe("vite page")
    expect(() =>
      fixture.approve({ sessionId: session.sessionId, state: session.state }),
    ).not.toThrow()
  })
})
