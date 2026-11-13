// 为原生窗口验收提供只绑定回环的合成会员服务，保留桌面 OAuth、safeStorage 与会员门禁。
import { createServer } from "node:http"
import { createHash, randomUUID } from "node:crypto"

const scopes = "user:read membership:read device:inspect device:revoke"
const userId = "native-ui-qa"

async function body(request) {
  let data = ""
  for await (const chunk of request) data += chunk
  return data
}

/** 启动合成服务，允许测试切换会员状态并完成本轮回调。 */
export async function startMembershipFixture() {
  const contexts = new Map()
  const tokens = new Map()
  let membership = "active"
  let pending = null
  let origin

  async function handle(request, response) {
    const url = new URL(request.url, origin)
    const json = (data, status = 200) => {
      response.writeHead(status, { "content-type": "application/json" })
      response.end(JSON.stringify(data))
    }
    if (request.method === "POST" && url.pathname === "/v1/desktop/oauth/contexts") {
      const input = JSON.parse(await body(request))
      const redirect = new URL(input.redirectUri)
      if (
        redirect.protocol !== "http:" ||
        redirect.hostname !== "127.0.0.1" ||
        !redirect.port ||
        redirect.pathname !== "/oauth/callback" ||
        redirect.search ||
        redirect.hash ||
        input.clientId !== "pigclaude-desktop" ||
        input.scopes.join(" ") !== scopes
      )
        return json({ error: "invalid_request" }, 400)
      const contextId = randomUUID()
      const authorization = new URL("/oauth2/authorize", origin)
      authorization.search = new URLSearchParams({
        response_type: "code",
        client_id: input.clientId,
        redirect_uri: input.redirectUri,
        code_challenge: input.codeChallenge,
        code_challenge_method: "S256",
        state: input.state,
        scope: scopes,
        device_context: contextId,
      })
      pending = { ...input, code: randomUUID(), exchangeReady: false }
      contexts.set(pending.code, pending)
      return json({
        contextId,
        authorizationUrl: authorization.href,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      })
    }
    if (url.pathname === "/oauth2/authorize") {
      response.writeHead(200, { "content-type": "text/plain" })
      return response.end("PigClaude native UI fixture")
    }
    if (request.method === "POST" && url.pathname === "/oauth2/token") {
      const input = new URLSearchParams(await body(request))
      const code = input.get("code")
      const context = contexts.get(code)
      const challenge = createHash("sha256")
        .update(input.get("code_verifier") ?? "")
        .digest("base64url")
      if (
        !context?.exchangeReady ||
        challenge !== context.codeChallenge ||
        input.get("client_id") !== "pigclaude-desktop" ||
        input.get("grant_type") !== "authorization_code" ||
        input.get("redirect_uri") !== context.redirectUri
      )
        return json({ error: "invalid_grant" }, 400)
      contexts.delete(code)
      const access = randomUUID()
      tokens.set(access, {
        userId,
        deviceId: context.deviceId,
        authVersion: "1",
        bindingEpoch: "1",
      })
      return json({
        access_token: access,
        refresh_token: randomUUID(),
        token_type: "Bearer",
        expires_in: 600,
        scope: scopes,
      })
    }
    const session = tokens.get(request.headers.authorization?.slice("Bearer ".length))
    if (!session) return json({ error: "invalid_token" }, 401)
    const active = membership === "active"
    const tier = { code: "qa", name: "测试会员", level: 1 }
    const facts = {
      status: membership,
      tier,
      validUntil: new Date(Date.now() + (active ? 86_400_000 : -86_400_000)).toISOString(),
    }
    if (
      url.pathname === "/v1/desktop/session" ||
      url.pathname === "/v1/desktop/membership/inspect"
    ) {
      return json(session)
    }
    if (url.pathname === "/v1/desktop/entitlement") return json(facts)
    if (url.pathname === "/v1/desktop/recovery") {
      return json({
        ...session,
        membership: facts,
        canRevoke: true,
        grantExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        account: { userId, nickname: "界面验收", email: "desktop@example.test", avatar: "" },
      })
    }
    if (url.pathname === "/v1/desktop/device-info") return json({})
    return json({ error: "not_found" }, 404)
  }

  const server = createServer((request, response) => {
    void handle(request, response).catch(() => {
      response.writeHead(400, { "content-type": "application/json" })
      response.end('{"error":"invalid_request"}')
    })
  })
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  origin = `http://127.0.0.1:${server.address().port}`
  return {
    origin,
    setMembership(status) {
      membership = status
    },
    async approve() {
      if (!pending) throw new Error("尚未发起桌面授权")
      pending.exchangeReady = true
      const callback = new URL(pending.redirectUri)
      callback.search = new URLSearchParams({ state: pending.state, code: pending.code })
      const response = await fetch(callback, { signal: AbortSignal.timeout(15_000) })
      if (!(await response.text()).includes("授权完成")) throw new Error("回环授权未完成")
    },
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
        server.closeAllConnections()
      }),
  }
}
