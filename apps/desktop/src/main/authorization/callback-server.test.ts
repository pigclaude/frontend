// 负责验证授权回环服务只监听本机并把合法回调交给主进程。
import { describe, expect, it } from "vitest"
import { createCallbackServer } from "./callback-server"

describe("createCallbackServer", () => {
  it("accepts the callback path on loopback and returns a completion page", async () => {
    let received = ""
    const server = await createCallbackServer(async (url) => {
      received = url
    })

    const response = await fetch(`${server.redirectUri}?code=abc&state=state`)
    const body = await response.text()
    await server.close()

    expect(response.status).toBe(200)
    expect(body).toContain("授权完成")
    expect(received).toContain("code=abc")
    expect(new URL(server.redirectUri).hostname).toBe("127.0.0.1")
  })

  it("rejects paths outside the callback endpoint", async () => {
    const server = await createCallbackServer(async () => undefined)
    const response = await fetch(server.redirectUri.replace("/oauth/callback", "/other"))
    await server.close()

    expect(response.status).toBe(404)
  })
})
