// 负责验证服务端上下文 URL 的不可变绑定和 native scope 上限不会被调用方扩大。
import { expect, it } from "vitest"
import { OAuthClient } from "./oauth-client"
const origin = "http://127.0.0.1:8788"
const input = {
  deviceId: "pcd_" + "1".repeat(64),
  platform: "darwin" as const,
  name: "桌面",
  clientId: "pigclaude-desktop",
  redirectUri: "pigclaude://authorize/callback",
  codeChallenge: "challenge",
  state: "original",
  scopes: ["user:read", "membership:read", "device:inspect", "device:revoke"],
}
function contextUrl() {
  const url = new URL("/oauth2/authorize", origin)
  for (const [key, value] of Object.entries({
    response_type: "code",
    client_id: "pigclaude-desktop",
    redirect_uri: "pigclaude://authorize/callback",
    code_challenge: "challenge",
    code_challenge_method: "S256",
    state: "original",
    scope: "user:read membership:read device:inspect device:revoke",
    device_context: "opaque",
  }))
    url.searchParams.set(key, value)
  return url
}
it.each(["state", "scope", "redirect_uri", "code_challenge", "response_type"])(
  "rejects a server context URL that changed %s",
  async (key) => {
    const url = contextUrl()
    url.searchParams.set(key, "changed")
    const client = new OAuthClient({
      baseUrl: origin,
      fetcher: async () =>
        Response.json({
          contextId: "opaque",
          authorizationUrl: url.toString(),
          expiresAt: "2026-10-20T01:00:00Z",
        }),
    })
    await expect(client.prepareDeviceAuthorization(input)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    })
  },
)
it.each(["openid", "offline_access", "device:use", "admin:read"])(
  "does not send forbidden native scope %s",
  async (scope) => {
    let calls = 0
    const client = new OAuthClient({
      baseUrl: origin,
      fetcher: async () => {
        calls++
        return Response.json({})
      },
    })
    await expect(
      client.prepareDeviceAuthorization({ ...input, scopes: [...input.scopes, scope] }),
    ).rejects.toThrow()
    expect(calls).toBe(0)
  },
)
