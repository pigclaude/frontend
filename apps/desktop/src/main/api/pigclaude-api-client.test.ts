// 负责验证 Electron 主进程访问 Rust API 时的 URL、错误码和秘密边界。
import { describe, expect, it, vi } from "vitest"
import { PigclaudeApiClient, PigclaudeApiError } from "./pigclaude-api-client"

const activeMembership = {
  startupPhase: "settled",
  revision: 1,
  state: "active",
  account: { userId: "user-1", nickname: "林舟", email: "user@example.com", avatar: "" },
  productCode: "pigclaude",
  planKind: "week",
  lifetime: false,
  membershipValidUntil: "2026-10-19T00:00:00Z",
  offlineValidUntil: null,
  lastVerifiedAt: "2026-10-18T00:00:00Z",
  nextVerificationAt: null,
  bindingEpoch: "2",
  errorCode: null,
  serverReason: null,
  authorizationUrl: null,
} as const

describe("PigclaudeApiClient", () => {
  it("maps a Rust desktop start response and resolves its relative authorization URL", async () => {
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe("http://127.0.0.1:8788/v1/desktop/authorizations/start")
      expect(init?.method).toBe("POST")
      expect(init?.headers).toMatchObject({ "content-type": "application/json" })
      expect(JSON.parse(String(init?.body))).toMatchObject({
        deviceId: "device-1",
        codeChallenge: "challenge",
        state: "state",
      })
      return new Response(
        JSON.stringify({
          flowId: "flow-1",
          authorizationUrl: "/authorize/flow-1/approve?state=state",
          expiresAt: "2026-10-18T00:10:00Z",
          clientId: "pigclaude-desktop",
          redirectUri: "http://127.0.0.1:43123/oauth/callback",
          callbackUrl: "http://127.0.0.1:43123/oauth/callback",
          purpose: "pigclaude-login",
        }),
        { status: 200 },
      )
    })
    const client = new PigclaudeApiClient({
      baseUrl: "http://127.0.0.1:8788",
      authorizationOrigin: "http://127.0.0.1:3000",
      fetcher,
    })

    await expect(
      client.startAuthorization({
        deviceId: "device-1",
        deviceFingerprintHash: "sha256:fingerprint",
        codeChallenge: "challenge",
        state: "state",
        clientId: "pigclaude-desktop",
        callbackUrl: "http://127.0.0.1:43123/oauth/callback",
        purpose: "pigclaude-login",
      }),
    ).resolves.toMatchObject({
      flowId: "flow-1",
      authorizationUrl: "http://127.0.0.1:3000/authorize/flow-1/approve?state=state",
    })
  })

  it("sends exchange through Rust and never turns response secrets into a renderer view", async () => {
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      expect(init?.method).toBe("POST")
      expect(JSON.parse(String(init?.body))).toEqual({
        flowId: "flow-1",
        code: "one-time-code",
        codeVerifier: "verifier",
        state: "state",
      })
      return new Response(
        JSON.stringify({
          deviceId: "device-1",
          bindingEpoch: "3",
          userId: "user-1",
          sessionCookie: "pigclaude_session=session-secret",
        }),
        { status: 200 },
      )
    })
    const client = new PigclaudeApiClient({ baseUrl: "http://127.0.0.1:8788", fetcher })

    const result = await client.exchangeAuthorization({
      flowId: "flow-1",
      code: "one-time-code",
      codeVerifier: "verifier",
      state: "state",
    })

    expect(result).toEqual({
      deviceId: "device-1",
      bindingEpoch: "3",
      userId: "user-1",
      sessionCookie: "pigclaude_session=session-secret",
    })
    expect(JSON.stringify(result)).not.toContain("token")
    expect(JSON.stringify(result)).not.toContain("credential")
  })

  it("normalizes server errors and network failures to stable API errors", async () => {
    const serverError = new PigclaudeApiClient({
      baseUrl: "http://127.0.0.1:8788",
      fetcher: vi.fn<typeof fetch>(
        async () =>
          new Response(JSON.stringify({ code: "AUTHORIZATION_DEVICE_REVOKED" }), { status: 409 }),
      ),
    })
    await expect(
      serverError.inspectMembership({ deviceId: "device-1", bindingEpoch: "3" }),
    ).rejects.toEqual(
      expect.objectContaining({ code: "AUTHORIZATION_DEVICE_REVOKED", status: 409 }),
    )

    const unavailable = new PigclaudeApiClient({
      baseUrl: "http://127.0.0.1:8788",
      fetcher: vi.fn<typeof fetch>(async () => {
        throw new TypeError("fetch failed")
      }),
    })
    await expect(
      unavailable.inspectMembership({ deviceId: "device-1", bindingEpoch: "3" }),
    ).rejects.toEqual(
      expect.objectContaining({ code: "SERVER_UNAVAILABLE" } satisfies Partial<PigclaudeApiError>),
    )
  })

  it("reads the membership contract without exposing the bearer to its return value", async () => {
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toContain("/v1/desktop/membership/inspect")
      expect(init?.headers).toMatchObject({ authorization: "Bearer access-secret" })
      expect(init?.headers).toMatchObject({ cookie: "pigclaude_session=session-secret" })
      return new Response(JSON.stringify(activeMembership), { status: 200 })
    })
    const client = new PigclaudeApiClient({
      baseUrl: "http://127.0.0.1:8788",
      fetcher,
      accessToken: async () => "access-secret",
      sessionCookie: async () => "session-secret",
    })

    const result = await client.inspectMembership({ deviceId: "device-1", bindingEpoch: "2" })
    expect(result).toEqual(activeMembership)
    expect(JSON.stringify(result)).not.toContain("access-secret")
  })

  it("normalizes the minimal desktop inspect response and preserves the server epoch", async () => {
    const client = new PigclaudeApiClient({
      baseUrl: "http://127.0.0.1:8788",
      sessionCookie: async () => "session-secret",
      fetcher: vi.fn<typeof fetch>(async (input, init) => {
        expect(String(input)).toContain("deviceId=device-1")
        expect(String(input)).toContain("bindingEpoch=2")
        expect(init?.headers).toMatchObject({ cookie: "pigclaude_session=session-secret" })
        return new Response(
          JSON.stringify({
            deviceId: "device-1",
            bindingEpoch: "3",
            status: "active",
            userId: "user-1",
          }),
          { status: 200 },
        )
      }),
    })

    await expect(
      client.inspectMembership({ deviceId: "device-1", bindingEpoch: "2" }),
    ).resolves.toMatchObject({
      state: "active",
      bindingEpoch: "3",
    })
  })
})

// 超时覆盖完整 fetch/body 生命周期，恢复时重用同一客户端。
it.each(["headers", "body"])("aborts stalled %s and recovers on retry", async (phase) => {
  vi.useFakeTimers()
  try {
    let signal: AbortSignal | null | undefined
    let recover = false
    const client = new PigclaudeApiClient({
      baseUrl: "http://127.0.0.1:8788",
      fetcher: async (_input, init) => {
        signal = init?.signal
        if (recover) return new Response(JSON.stringify(activeMembership))
        if (phase === "headers") return new Promise<Response>(() => {})
        return new Response(new ReadableStream({ start() {} }))
      },
    })
    let code = "pending"
    const request = client
      .inspectMembership({ deviceId: "device-1", bindingEpoch: "2" })
      .catch((error: unknown) => {
        code = (error as PigclaudeApiError).code
      })
    await vi.advanceTimersByTimeAsync(15_000)
    expect(code).toBe("SERVER_UNAVAILABLE")
    expect(signal?.aborted).toBe(true)
    await request
    recover = true
    await expect(
      client.inspectMembership({ deviceId: "device-1", bindingEpoch: "2" }),
    ).resolves.toMatchObject({ state: "active" })
  } finally {
    vi.useRealTimers()
  }
})
