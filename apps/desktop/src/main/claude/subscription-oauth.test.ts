// Claude 订阅 OAuth 测试。覆盖授权 URL、回调、code 交换、refresh、profile 和错误边界。

import { createServer } from "node:net"
import { ProxyAgent, type Dispatcher } from "undici"
import { describe, expect, it } from "vitest"
import { createPkceChallenge } from "../authorization/pkce"
import {
  createSubscriptionOAuthRequest,
  SubscriptionOAuth,
  SubscriptionOAuthError,
} from "./subscription-oauth"

type FetchInit = {
  method?: string
  headers?: Record<string, string>
  body?: string
  dispatcher?: Dispatcher
}

describe("subscription oauth", () => {
  it("creates a state and S256 PKCE pair", () => {
    const request = createSubscriptionOAuthRequest()
    expect(request.state.length).toBeGreaterThan(20)
    expect(request.codeVerifier.length).toBeGreaterThan(20)
    expect(request.codeChallenge).toBe(createPkceChallenge(request.codeVerifier))
  })

  it("builds the official authorize URL without the verifier", () => {
    const request = createSubscriptionOAuthRequest()
    const url = new URL(
      new SubscriptionOAuth().buildAuthorizeUrl({
        redirectUri: "http://localhost:1234/callback",
        state: request.state,
        codeChallenge: request.codeChallenge,
      }),
    )
    expect(url.origin).toBe("https://claude.com")
    expect(url.pathname).toBe("/cai/oauth/authorize")
    expect(url.searchParams.get("code")).toBe("true")
    expect(url.searchParams.get("client_id")).toBe("9d1c250a-e61b-44d9-88ed-5944d1962f5e")
    expect(url.searchParams.get("response_type")).toBe("code")
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:1234/callback")
    expect(url.searchParams.get("code_challenge")).toBe(request.codeChallenge)
    expect(url.searchParams.get("code_challenge_method")).toBe("S256")
    expect(url.searchParams.get("state")).toBe(request.state)
    expect(url.searchParams.get("scope")).toContain("user:inference")
    expect(url.searchParams.get("scope")).toContain("user:profile")
    expect(url.search).not.toContain("code_verifier")
  })

  it("receives a callback code and validates state", async () => {
    const oauth = new SubscriptionOAuth()
    const request = createSubscriptionOAuthRequest()
    const callback = await oauth.startCallback({ state: request.state, timeoutMs: 2_000 })
    expect(callback.isComplete()).toBe(false)
    const response = await fetch(
      `${callback.redirectUri}?code=code-1&state=${encodeURIComponent(request.state)}`,
    )
    expect(response.status).toBe(200)
    expect(await response.text()).toContain("授权完成")
    expect(callback.isComplete()).toBe(true)
    expect(await callback.waitForCode()).toBe("code-1")
    await callback.close()
  })

  it("rejects a wrong state without exchanging the code", async () => {
    const oauth = new SubscriptionOAuth()
    const request = createSubscriptionOAuthRequest()
    const callback = await oauth.startCallback({ state: request.state, timeoutMs: 2_000 })
    await fetch(`${callback.redirectUri}?code=code-1&state=wrong`)
    await expect(callback.waitForCode()).rejects.toMatchObject({
      code: "OAUTH_STATE_MISMATCH",
    })
    await callback.close()
  })

  it("maps provider denial and timeout to stable codes", async () => {
    const oauth = new SubscriptionOAuth()
    const deniedRequest = createSubscriptionOAuthRequest()
    const denied = await oauth.startCallback({ state: deniedRequest.state, timeoutMs: 2_000 })
    await fetch(`${denied.redirectUri}?error=access_denied&state=${deniedRequest.state}`)
    await expect(denied.waitForCode()).rejects.toMatchObject({ code: "OAUTH_DENIED" })
    await denied.close()

    const timeoutRequest = createSubscriptionOAuthRequest()
    const timedOut = await oauth.startCallback({ state: timeoutRequest.state, timeoutMs: 20 })
    await expect(timedOut.waitForCode()).rejects.toMatchObject({
      code: "AUTHORIZATION_TIMEOUT",
    })
    await timedOut.close()
  })

  it("rejects cancellation before a callback arrives", async () => {
    const oauth = new SubscriptionOAuth()
    const request = createSubscriptionOAuthRequest()
    const callback = await oauth.startCallback({ state: request.state, timeoutMs: 2_000 })
    await callback.close()
    await expect(callback.waitForCode()).rejects.toMatchObject({
      code: "AUTHORIZATION_CANCELLED",
    })
  })

  it("取消等待时保留回调端口，显式关闭后才释放", async () => {
    const callback = await new SubscriptionOAuth().startCallback({
      state: "synthetic",
      timeoutMs: 2_000,
    })
    const port = Number(new URL(callback.redirectUri).port)
    try {
      callback.cancel()
      await expect(callback.waitForCode()).rejects.toMatchObject({
        code: "AUTHORIZATION_CANCELLED",
      })
      expect(await canBind(port)).toBe(false)
      const late = await fetch(`${callback.redirectUri}?code=synthetic&state=synthetic`)
      expect(await late.text()).toContain("授权已结束")
      await callback.close()
      expect(await canBind(port)).toBe(true)
    } finally {
      await callback.close()
    }
  })

  it("exchanges an authorization code with the injected dispatcher", async () => {
    const dispatcher = new ProxyAgent("http://127.0.0.1:1")
    try {
      const seen: Array<{ url: string; init: FetchInit }> = []
      const oauth = new SubscriptionOAuth({
        tokenUrl: "https://token.test/v1/oauth/token",
        now: () => 1_000,
        fetch: sequenceFetch([
          (url, init) => {
            seen.push({ url, init })
            return Promise.resolve(
              json({
                access_token: "access",
                refresh_token: "refresh",
                expires_in: 300,
                scope: "user:inference user:profile",
              }),
            )
          },
        ]),
      })
      const tokens = await oauth.exchangeCode({
        code: "code-1",
        state: "state-1",
        codeVerifier: "verifier-1",
        redirectUri: "http://localhost:1234/callback",
        dispatcher,
      })
      expect(tokens).toEqual({
        accessToken: "access",
        refreshToken: "refresh",
        expiresAt: 301_000,
        scopes: ["user:inference", "user:profile"],
      })
      expect(seen[0]?.url).toBe("https://token.test/v1/oauth/token")
      expect(seen[0]?.init.dispatcher).toBe(dispatcher)
      expect(seen[0]?.init.method).toBe("POST")
      expect(seen[0]?.init.body).toContain('"grant_type":"authorization_code"')
      expect(seen[0]?.init.body).toContain('"code":"code-1"')
      expect(seen[0]?.init.body).toContain('"code_verifier":"verifier-1"')
    } finally {
      await dispatcher.close()
    }
  })

  it("uses the default network when no dispatcher is given", async () => {
    const seen: FetchInit[] = []
    const oauth = new SubscriptionOAuth({
      now: () => 1_000,
      fetch: sequenceFetch([
        (_url, init) => {
          seen.push(init)
          return Promise.resolve(
            json({ access_token: "access", refresh_token: "refresh", expires_in: 300 }),
          )
        },
        (_url, init) => {
          seen.push(init)
          return Promise.resolve(json({ account: { uuid: "account-uuid" } }))
        },
        (_url, init) => {
          seen.push(init)
          return Promise.resolve(
            json({ access_token: "next", refresh_token: "next-refresh", expires_in: 300 }),
          )
        },
      ]),
    })
    const tokens = await oauth.exchangeCode({
      code: "code-1",
      state: "state-1",
      codeVerifier: "verifier-1",
      redirectUri: "http://localhost:1234/callback",
    })
    expect(tokens.accessToken).toBe("access")
    expect(await oauth.readProfile({ accessToken: tokens.accessToken })).toMatchObject({
      accountUuid: "account-uuid",
    })
    expect((await oauth.refresh({ refreshToken: "refresh" })).accessToken).toBe("next")
    expect(seen).toHaveLength(3)
    for (const init of seen) expect("dispatcher" in init).toBe(false)
  })

  it("rejects incomplete token responses without leaking the body", async () => {
    const dispatcher = new ProxyAgent("http://127.0.0.1:1")
    try {
      const oauth = new SubscriptionOAuth({
        fetch: sequenceFetch([
          () => Promise.resolve(json({ access_token: "secret", expires_in: 300 })),
        ]),
      })
      const error = await oauth
        .exchangeCode({
          code: "code",
          state: "state",
          codeVerifier: "verifier",
          redirectUri: "http://localhost:1234/callback",
          dispatcher,
        })
        .catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(SubscriptionOAuthError)
      expect((error as SubscriptionOAuthError).code).toBe("OAUTH_EXCHANGE_FAILED")
      expect((error as Error).message).not.toContain("secret")
    } finally {
      await dispatcher.close()
    }
  })

  it("rotates refresh tokens and keeps the old one when omitted", async () => {
    const dispatcher = new ProxyAgent("http://127.0.0.1:1")
    try {
      const rotated = new SubscriptionOAuth({
        fetch: sequenceFetch([
          () =>
            Promise.resolve(
              json({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 60 }),
            ),
        ]),
      })
      const first = await rotated.refresh({ refreshToken: "old-refresh", dispatcher })
      expect(first.refreshToken).toBe("new-refresh")

      const kept = new SubscriptionOAuth({
        fetch: sequenceFetch([
          () => Promise.resolve(json({ access_token: "new-access", expires_in: 60 })),
        ]),
      })
      const second = await kept.refresh({ refreshToken: "old-refresh", dispatcher })
      expect(second.refreshToken).toBe("old-refresh")
    } finally {
      await dispatcher.close()
    }
  })

  it("classifies invalid_grant as a reauthorization requirement", async () => {
    const dispatcher = new ProxyAgent("http://127.0.0.1:1")
    try {
      const oauth = new SubscriptionOAuth({
        fetch: sequenceFetch([() => Promise.resolve(json({ error: "invalid_grant" }, 400))]),
      })
      const error = await oauth
        .refresh({ refreshToken: "old", dispatcher })
        .catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(SubscriptionOAuthError)
      expect((error as SubscriptionOAuthError).code).toBe("CREDENTIAL_REFRESH_FAILED")
      expect((error as SubscriptionOAuthError).invalidGrant).toBe(true)
    } finally {
      await dispatcher.close()
    }
  })

  it("reads profile metadata and treats failures as non-blocking", async () => {
    const dispatcher = new ProxyAgent("http://127.0.0.1:1")
    try {
      const oauth = new SubscriptionOAuth({
        fetch: sequenceFetch([
          () =>
            Promise.resolve(
              json({
                account: { uuid: "account-uuid", email: "user@example.com" },
                organization: {
                  uuid: "organization-uuid",
                  organization_type: "claude_max",
                  rate_limit_tier: "tier-1",
                },
              }),
            ),
        ]),
      })
      expect(await oauth.readProfile({ accessToken: "token", dispatcher })).toEqual({
        accountUuid: "account-uuid",
        email: "user@example.com",
        organizationUuid: "organization-uuid",
        subscriptionType: "max",
        rateLimitTier: "tier-1",
      })

      const failing = new SubscriptionOAuth({
        fetch: sequenceFetch([() => Promise.resolve(json({}, 500))]),
      })
      expect(await failing.readProfile({ accessToken: "token", dispatcher })).toBeNull()
    } finally {
      await dispatcher.close()
    }
  })
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

async function canBind(port: number): Promise<boolean> {
  const server = createServer()
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(port, "127.0.0.1", resolve)
    })
    return true
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "EADDRINUSE") return false
    throw error
  } finally {
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

function sequenceFetch(
  responses: Array<(url: string, init: FetchInit) => Promise<Response>>,
): typeof import("undici").fetch {
  let index = 0
  const fake = async (input: unknown, init: unknown): Promise<Response> => {
    const next = responses[index]
    index += 1
    if (next === undefined) throw new Error("unexpected fetch")
    return next(String(input), (init ?? {}) as FetchInit)
  }
  return fake as unknown as typeof import("undici").fetch
}
