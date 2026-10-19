// 负责独立public OAuth客户端：真实loopback回调、随机PKCE/state和标准form交换，不使用产品私有交换协议。
import { createServer } from "node:http"
import { createHash, randomBytes } from "node:crypto"
import { expect, type Page } from "@playwright/test"

/** 通过真实中央审批页面完成native授权，所有token只保留在Node测试客户端。 */
export async function authorizeNative(page: Page, home: string, deviceId: string) {
  const state = randomBytes(32).toString("base64url")
  const verifier = randomBytes(32).toString("base64url")
  const challenge = createHash("sha256").update(verifier).digest("base64url")
  let receive: (code: string) => void = () => undefined
  const callback = new Promise<string>((done) => {
    receive = done
  })
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1")
    if (
      url.pathname !== "/oauth/callback" ||
      url.searchParams.get("state") !== state ||
      !url.searchParams.get("code")
    ) {
      response.writeHead(400).end("Invalid local callback")
      return
    }
    response
      .writeHead(200, { "content-type": "text/plain", "cache-control": "no-store" })
      .end("Local native authorization complete")
    receive(url.searchParams.get("code") ?? "")
  })
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("LOCAL_CALLBACK_LISTENER_FAILED")
  const redirect = `http://127.0.0.1:${address.port}/oauth/callback`
  try {
    const response = await fetch(`${home}/v1/desktop/oauth/contexts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deviceId,
        platform: "macos",
        name: "Local browser device",
        clientId: "pigclaude-desktop",
        redirectUri: redirect,
        codeChallenge: challenge,
        state,
        scopes: ["user:read", "membership:read", "device:inspect", "device:revoke"],
      }),
    })
    expect(response.status).toBe(200)
    const prepared = (await response.json()) as { authorizationUrl: string }
    await page.goto(prepared.authorizationUrl).catch(() => {
      throw new Error("LOCAL_NATIVE_NAVIGATION_FAILED")
    })
    await page.getByRole("button", { name: "授权设备", exact: true }).click()
    const code = await Promise.race([
      callback,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("LOCAL_CALLBACK_TIMEOUT")), 15_000),
      ),
    ])
    const token = await fetch(`${home}/oauth2/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: "pigclaude-desktop",
        redirect_uri: redirect,
        code,
        code_verifier: verifier,
      }),
    })
    expect(token.status).toBe(200)
    const tokens = (await token.json().catch(() => {
      throw new Error("LOCAL_NATIVE_TOKEN_RESPONSE_INVALID")
    })) as {
      access_token: string
      refresh_token: string
      scope: string
      id_token?: string
      state?: string
      flow_id?: string
    }
    expect(tokens.id_token === undefined).toBe(true)
    expect(tokens.state === undefined).toBe(true)
    expect(tokens.flow_id === undefined).toBe(true)
    expect(tokens.scope.includes("openid")).toBe(false)
    return tokens
  } finally {
    server.closeAllConnections()
    await new Promise<void>((done) => server.close(() => done()))
  }
}
