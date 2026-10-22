// 负责验证实际 composition 的 OAuth 登录、回调拒绝和 logout 本机写入屏障。
import { describe, expect, it } from "vitest"
import { createDesktopComposition } from "../composition"
import { deferred, ProfileVault } from "../testing/profile-fixture"

const origin = "http://127.0.0.1:8788"
const redirect = "http://127.0.0.1:43123/oauth/callback"
const request = { purpose: "pigclaude-login", mode: "login" } as const
const deviceId = "pcd_" + "a".repeat(64)
const identity = { read: async () => ({ deviceId, platform: "darwin" as const }) }
const token = {
  access_token: "pc_at_test",
  token_type: "Bearer",
  expires_in: 300,
  refresh_token: "pc_rt_test",
  scope: "user:read membership:read device:inspect device:revoke",
}
const session = {
  userId: "9223372036854775807",
  deviceId,
  bindingEpoch: "9007199254740993",
  authVersion: "9223372036854775807",
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })

function setup(
  options: {
    exchange?: () => Promise<Response>
    inspect?: () => Promise<Response>
    prepareExpiry?: number
    now?: () => number
  } = {},
) {
  const vault = new ProfileVault()
  const calls: { path: string; init?: RequestInit }[] = []
  const composition = createDesktopComposition({
    vault,
    authOrigin: origin,
    now: options.now ?? (() => 1_000),
    deviceIdentity: identity,
    apiOptions: {
      baseUrl: origin,
      fetcher: async (url, init) => {
        const path = new URL(String(url)).pathname
        calls.push({ path, init })
        if (path === "/v1/desktop/oauth/contexts") {
          const input = JSON.parse(String(init?.body)) as Record<string, string | string[]>
          const authorizationUrl = new URL("/oauth2/authorize", origin)
          for (const [key, value] of Object.entries({
            response_type: "code",
            client_id: input.clientId,
            redirect_uri: input.redirectUri,
            code_challenge: input.codeChallenge,
            code_challenge_method: "S256",
            state: input.state,
            scope: (input.scopes as string[]).join(" "),
            device_context: "opaque",
          })) {
            authorizationUrl.searchParams.set(key, String(value))
          }
          return json({
            contextId: "opaque",
            authorizationUrl: authorizationUrl.toString(),
            expiresAt: new Date(options.prepareExpiry ?? 601_000).toISOString(),
          })
        }
        if (path === "/oauth2/token") return options.exchange ? options.exchange() : json(token)
        if (path === "/v1/desktop/session") return json(session)
        if (path === "/v1/desktop/membership/inspect")
          return options.inspect ? options.inspect() : json({ ...session, status: "active" })
        if (path === "/v1/desktop/entitlement")
          return json({
            status: "active",
            tier: { code: "vip", name: "VIP", level: 1 },
            bindingEpoch: session.bindingEpoch,
          })
        return json({ error: "obsolete_endpoint" }, 404)
      },
    },
  })
  return { composition, vault, calls }
}

describe("AuthorizationService real native OAuth adapter", () => {
  it("uses actual context/token/session endpoints and persists only schema1 oauth2 verified material", async () => {
    const { composition, vault, calls } = setup()
    const started = await composition.authorizationService.start(request, redirect)
    const url = new URL(started.authorizationUrl)
    expect(url.pathname).toBe("/oauth2/authorize")
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      response_type: "code",
      client_id: "pigclaude-desktop",
      redirect_uri: redirect,
      code_challenge_method: "S256",
      scope: "user:read membership:read device:inspect device:revoke",
      device_context: "opaque",
    })
    const active = composition.authorizationService.getActiveSession()
    expect(started.authorizationUrl).not.toContain(active?.codeVerifier)
    const result = await composition.authorizationService.handleCallback(
      `${redirect}?code=code&state=${active?.state}`,
    )
    expect(result).toMatchObject({ status: "completed", accountId: session.userId })
    const saved = JSON.parse((await vault.get("membership:session")) ?? "null") as unknown
    expect(saved).toMatchObject({
      schemaVersion: 1,
      protocol: "oauth2",
      ...session,
      accessToken: "pc_at_test",
      refreshToken: "pc_rt_test",
      accessTokenExpiresAt: 301_000,
      refreshTokenExpiresAt: 2_592_001_000,
      scope: token.scope,
    })
    expect(JSON.stringify(saved)).not.toContain("sessionCookie")
    expect(JSON.stringify(result)).not.toContain("pc_at_")
    expect(JSON.stringify(result)).not.toContain("pc_rt_")
    expect(calls.map((call) => call.path)).toContain("/v1/desktop/session")
    expect(calls.map((call) => call.path)).toContain("/v1/desktop/entitlement")
    for (const call of calls.filter(
      (call) => call.path.startsWith("/v1/desktop/") && call.path !== "/v1/desktop/oauth/contexts",
    )) {
      expect(new Headers(call.init?.headers).get("authorization")).toBe("Bearer pc_at_test")
      expect(new Headers(call.init?.headers).has("cookie")).toBe(false)
    }
    await composition.dispose()
  })
  it.each([
    "path",
    "state",
    "expired",
    "fragment",
    "userinfo",
    "duplicate",
    "empty-fragment",
    "normalized-path",
    "empty-userinfo",
  ])("rejects %s callbacks before code exchange", async (kind) => {
    let now = 1_000
    const { composition, calls } = setup({ now: () => now })
    await composition.authorizationService.start(request, redirect)
    const state = composition.authorizationService.getActiveSession()?.state
    let callback = `${redirect}?code=code&state=${state}`
    if (kind === "path") callback = callback.replace("/oauth/callback", "/other")
    if (kind === "state") callback = `${redirect}?code=code&state=wrong`
    if (kind === "expired") now = 601_000
    if (kind === "fragment") callback += "#fragment"
    if (kind === "empty-fragment") callback += "#"
    if (kind === "normalized-path")
      callback = callback.replace("/oauth/callback", "/oauth/other/../callback")
    if (kind === "empty-userinfo") callback = callback.replace("127.0.0.1", "@127.0.0.1")
    if (kind === "userinfo") callback = callback.replace("127.0.0.1", "other@127.0.0.1")
    if (kind === "duplicate") callback += "&code=second"
    expect((await composition.authorizationService.handleCallback(callback)).status).not.toBe(
      "completed",
    )
    expect(calls.some((call) => call.path === "/oauth2/token")).toBe(false)
    await composition.dispose()
  })
  it("uses the server's earlier context deadline rather than renewing local TTL", async () => {
    let now = 1_000
    const { composition, calls } = setup({ prepareExpiry: 2_000, now: () => now })
    const started = await composition.authorizationService.start(request, redirect)
    expect(started.expiresAt).toBe(2_000)
    now = 2_000
    const state = composition.authorizationService.getActiveSession()?.state
    expect(
      await composition.authorizationService.handleCallback(`${redirect}?code=late&state=${state}`),
    ).toMatchObject({ status: "expired" })
    expect(calls.some((call) => call.path === "/oauth2/token")).toBe(false)
    await composition.dispose()
  })
  it("does not send the Claude-account purpose or a Claude credential to the Pigclaude grant", async () => {
    const { composition, vault, calls } = setup()
    await vault.set("authorization:claude-account:pool", "claude-secret")
    await expect(
      composition.authorizationService.start(
        { purpose: "claude-account", mode: "authorize", bridgeExit: "same", daemonExit: "same" },
        redirect,
      ),
    ).rejects.toThrow("CLAUDE_AUTHORIZATION_UNAVAILABLE")
    expect(calls).toHaveLength(0)
    await composition.signOut()
    expect(await vault.get("authorization:claude-account:pool")).toBe("claude-secret")
    await composition.dispose()
  })
  it("rejects the old unversioned vault shape without restoring or touching the network", async () => {
    const { composition, vault, calls } = setup()
    await vault.set(
      "membership:session",
      JSON.stringify({
        deviceId,
        bindingEpoch: "1",
        accessToken: "old",
        sessionCookie: "old-cookie",
      }),
    )
    expect(await composition.membershipGate.inspect()).toMatchObject({ state: "signed_out" })
    expect(calls).toHaveLength(0)
    await composition.dispose()
  })
  it("does not wait for late code HTTP on logout and cannot repopulate a new login", async () => {
    const entered = deferred<void>()
    const response = deferred<Response>()
    const { composition, vault } = setup({
      exchange: async () => {
        entered.resolve(undefined)
        return response.promise
      },
    })
    await composition.authorizationService.start(request, redirect)
    const state = composition.authorizationService.getActiveSession()?.state
    const callback = composition.authorizationService.handleCallback(
      `${redirect}?code=old&state=${state}`,
    )
    await entered.promise
    await composition.signOut()
    response.resolve(json(token))
    expect(await callback).toMatchObject({ status: "cancelled" })
    expect(await vault.get("membership:session")).toBeNull()
    expect(composition.membershipGate.view().state).toBe("signed_out")
    await composition.dispose()
  })
  it("drains an entered OAuth session write before local cleanup", async () => {
    const { composition, vault } = setup()
    const entered = deferred<void>()
    const release = deferred<void>()
    vault.beforeSet = async (key) => {
      if (key === "membership:session") {
        entered.resolve(undefined)
        await release.promise
      }
    }
    await composition.authorizationService.start(request, redirect)
    const state = composition.authorizationService.getActiveSession()?.state
    const callback = composition.authorizationService.handleCallback(
      `${redirect}?code=code&state=${state}`,
    )
    await entered.promise
    let finished = false
    const logout = composition.signOut().then(() => {
      finished = true
    })
    await Promise.resolve()
    expect(finished).toBe(false)
    release.resolve(undefined)
    await logout
    expect(await callback).toMatchObject({ status: "cancelled" })
    expect(await vault.get("membership:session")).toBeNull()
    expect(composition.membershipGate.view().state).toBe("signed_out")
    await composition.dispose()
  })
  it("does not wait for onCompleted membership HTTP during local sign-out", async () => {
    const entered = deferred<void>()
    const response = deferred<Response>()
    const { composition, vault } = setup({
      inspect: async () => {
        entered.resolve(undefined)
        return response.promise
      },
    })
    await composition.authorizationService.start(request, redirect)
    const state = composition.authorizationService.getActiveSession()?.state
    const callback = composition.authorizationService.handleCallback(
      `${redirect}?code=code&state=${state}`,
    )
    await entered.promise
    await composition.signOut()
    expect(await vault.get("membership:session")).toBeNull()
    response.resolve(json({ ...session, status: "active" }))
    expect(await callback).toMatchObject({ status: "cancelled" })
    expect(composition.membershipGate.view().state).toBe("signed_out")
    await composition.dispose()
  })
  it("does not extend token expiry by time spent awaiting token HTTP", async () => {
    let now = 1_000
    const { composition, vault } = setup({
      now: () => now,
      exchange: async () => {
        now = 2_000
        return json(token)
      },
    })
    await composition.authorizationService.start(request, redirect)
    const state = composition.authorizationService.getActiveSession()?.state
    await composition.authorizationService.handleCallback(`${redirect}?code=code&state=${state}`)
    expect(JSON.parse((await vault.get("membership:session")) ?? "null") as unknown).toMatchObject({
      accessTokenExpiresAt: 301_000,
      refreshTokenExpiresAt: 2_592_001_000,
    })
    await composition.dispose()
  })
  it("uses the formal private protocol callback and rejects another private path", async () => {
    const { composition, calls } = setup()
    await composition.authorizationService.start(request, "pigclaude://authorize/callback")
    const state = composition.authorizationService.getActiveSession()?.state
    expect(
      await composition.authorizationService.handleCallback(
        `pigclaude://authorize/other?code=code&state=${state}`,
      ),
    ).toMatchObject({ status: "state-mismatch" })
    expect(calls.some((call) => call.path === "/oauth2/token")).toBe(false)
    expect(
      await composition.authorizationService.handleCallback(
        `pigclaude://authorize/callback?code=code&state=${state}`,
      ),
    ).toMatchObject({ status: "completed" })
    await composition.dispose()
  })
})
