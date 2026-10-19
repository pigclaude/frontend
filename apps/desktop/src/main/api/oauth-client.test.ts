// 负责验证真实 OAuth adapter 的标准表单、设备平台与错误协议边界。
import { describe, expect, it } from "vitest"
import { OAuthClient } from "./oauth-client"

const baseUrl = "http://127.0.0.1:8788"
const redirectUri = "http://127.0.0.1:43123/oauth/callback"
const scopes = ["user:read", "membership:read", "device:inspect", "device:revoke"]
const token = {
  access_token: "pc_at_fixture",
  token_type: "Bearer",
  expires_in: 300,
  refresh_token: "pc_rt_fixture",
  scope: scopes.join(" "),
}
const session = {
  userId: "9223372036854775807",
  deviceId: "pcd_" + "a".repeat(64),
  bindingEpoch: "9007199254740993",
  authVersion: "9223372036854775807",
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })

describe("OAuthClient native public protocol", () => {
  it.each([
    ["darwin", "macos"],
    ["win32", "windows"],
    ["linux", "linux"],
  ] as const)("maps %s only in the prepare network DTO", async (platform, expected) => {
    const calls: { url: string; init?: RequestInit }[] = []
    const client = new OAuthClient({
      baseUrl,
      fetcher: async (url, init) => {
        calls.push({ url: String(url), init })
        return json({
          contextId: "opaque",
          authorizationUrl:
            baseUrl +
            "/oauth2/authorize?" +
            new URLSearchParams({
              response_type: "code",
              client_id: "pigclaude-desktop",
              redirect_uri: redirectUri,
              code_challenge: "challenge",
              code_challenge_method: "S256",
              state: "state",
              scope: scopes.join(" "),
              device_context: "opaque",
            }).toString(),
          expiresAt: "2026-10-20T01:10:00Z",
        })
      },
    })
    await client.prepareDeviceAuthorization({
      ...session,
      platform,
      name: "桌面",
      clientId: "pigclaude-desktop",
      redirectUri,
      codeChallenge: "challenge",
      state: "state",
      scopes,
    })
    expect(calls[0]?.url).toBe(baseUrl + "/v1/desktop/oauth/contexts")
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      deviceId: session.deviceId,
      platform: expected,
      name: "桌面",
      clientId: "pigclaude-desktop",
      redirectUri,
      codeChallenge: "challenge",
      state: "state",
      scopes,
    })
    expect(new Headers(calls[0]?.init?.headers).has("authorization")).toBe(false)
  })
  it("exchanges, rotates and revokes with form bodies and no cookies or client secret", async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    const client = new OAuthClient({
      baseUrl,
      accessToken: async () => "unrelated",
      fetcher: async (url, init) => {
        calls.push({ url: String(url), init })
        return json(token)
      },
    })
    expect(
      await client.exchangeCode({
        clientId: "pigclaude-desktop",
        redirectUri,
        code: "code+/&=",
        codeVerifier: "verifier+/&=",
      }),
    ).toEqual(token)
    await client.refreshToken("refresh+/&=")
    await client.revokeToken("refresh+/&=")
    expect(calls.map((call) => call.url)).toEqual([
      baseUrl + "/oauth2/token",
      baseUrl + "/oauth2/token",
      baseUrl + "/oauth2/revoke",
    ])
    const bodies = calls.map((call) =>
      Object.fromEntries(new URLSearchParams(String(call.init?.body))),
    )
    expect(bodies).toEqual([
      {
        grant_type: "authorization_code",
        client_id: "pigclaude-desktop",
        redirect_uri: redirectUri,
        code: "code+/&=",
        code_verifier: "verifier+/&=",
      },
      { grant_type: "refresh_token", client_id: "pigclaude-desktop", refresh_token: "refresh+/&=" },
      { client_id: "pigclaude-desktop", token: "refresh+/&=" },
    ])
    for (const call of calls) {
      const headers = new Headers(call.init?.headers)
      expect(headers.get("content-type")).toBe("application/x-www-form-urlencoded")
      expect(headers.has("cookie")).toBe(false)
      expect(headers.has("authorization")).toBe(false)
      expect(call.init?.credentials).toBe("omit")
    }
  })
  it("reads all verified session identifiers losslessly through Bearer", async () => {
    const client = new OAuthClient({
      baseUrl,
      fetcher: async (url, init) => {
        expect(String(url)).toBe(baseUrl + "/v1/desktop/session")
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer pc_at_fixture")
        expect(new Headers(init?.headers).has("cookie")).toBe(false)
        return json(session)
      },
    })
    expect(await client.readDesktopSession("pc_at_fixture")).toEqual(session)
  })
  it.each(["ACCOUNT_BANNED", "DEVICE_REVOKED"])(
    "preserves fixed %s instead of swallowing app_error",
    async (code) => {
      const client = new OAuthClient({
        baseUrl,
        fetcher: async () => json({ error: "invalid_grant", app_error: code }, 400),
      })
      await expect(client.refreshToken("old")).rejects.toMatchObject({
        code,
        status: 400,
        oauthError: "invalid_grant",
      })
    },
  )
  it.each([
    { ...token, id_token: "forbidden" },
    { ...token, token_type: "Other" },
    { ...token, scope: "openid" },
    { ...token, expires_in: -1 },
    { ...token, refresh_token: "" },
  ])("rejects malformed or OIDC token material %#", async (body) => {
    const client = new OAuthClient({ baseUrl, fetcher: async () => json(body) })
    await expect(
      client.exchangeCode({
        clientId: "pigclaude-desktop",
        redirectUri,
        code: "code",
        codeVerifier: "verifier",
      }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" })
  })
  it("rejects numeric versions rather than rounding them", async () => {
    const client = new OAuthClient({
      baseUrl,
      fetcher: async () => json({ ...session, authVersion: 2 }),
    })
    await expect(client.readDesktopSession("token")).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    })
  })
})

it("does not expose unknown remote code or error strings as fixed UI errors", async () => {
  const api = new OAuthClient({
    baseUrl: "http://127.0.0.1:8788",
    fetcher: async () =>
      new Response(
        JSON.stringify({
          error: "remote-secret",
          code: "raw-secret",
          error_description: "private",
        }),
        { status: 401 },
      ),
  })
  await expect(api.refreshToken("fixture-refresh")).rejects.toMatchObject({
    code: "HTTP_ERROR",
    oauthError: undefined,
  })
})
