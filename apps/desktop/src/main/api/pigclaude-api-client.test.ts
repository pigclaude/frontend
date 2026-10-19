// 负责验证原生业务 Bearer、inspect/entitlement 双路与固定错误传播。
import { describe, expect, it, vi } from "vitest"
import { PigclaudeApiClient, PigclaudeApiError } from "./pigclaude-api-client"
const baseUrl = "http://127.0.0.1:8788"
const deviceId = "pcd_" + "1".repeat(64)
const session = {
  userId: "9223372036854775807",
  deviceId,
  bindingEpoch: "9007199254740993",
  authVersion: "9223372036854775807",
  status: "active",
}
const entitlement = {
  productCode: "pigclaude",
  planKind: "week",
  status: "active",
  lifetime: false,
  validUntil: "2026-10-21T00:00:00Z",
  termsVersion: "1",
  termsAcceptedAt: "2026-10-19T00:00:00Z",
  entitlementVersion: "1",
}
const input = { deviceId, bindingEpoch: session.bindingEpoch }

describe("PigclaudeApiClient native resources", () => {
  it("combines real thin inspect and richer entitlement with a single captured Bearer and no device query", async () => {
    const paths: string[] = []
    const client = new PigclaudeApiClient({
      baseUrl,
      accessToken: async () => "access-secret",
      fetcher: async (url, init) => {
        paths.push(String(url))
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer access-secret")
        expect(new Headers(init?.headers).has("cookie")).toBe(false)
        return Response.json(String(url).endsWith("/inspect") ? session : entitlement)
      },
    })
    const result = await client.inspectMembership(input)
    expect(paths).toEqual([
      baseUrl + "/v1/desktop/membership/inspect",
      baseUrl + "/v1/desktop/entitlement",
    ])
    expect(result).toMatchObject({
      state: "active",
      bindingEpoch: session.bindingEpoch,
      account: { userId: session.userId },
      membershipValidUntil: entitlement.validUntil,
      offlineValidUntil: null,
    })
    expect(JSON.stringify(result)).not.toContain("access-secret")
  })
  it("revokeDeviceBinding sends only empty JSON to the current Bearer relationship", async () => {
    let body: unknown
    const client = new PigclaudeApiClient({
      baseUrl,
      accessToken: async () => "access-secret",
      fetcher: async (url, init) => {
        expect(String(url)).toBe(baseUrl + "/v1/desktop/devices/revoke")
        expect(init?.method).toBe("POST")
        body = JSON.parse(String(init?.body)) as unknown
        return new Response(null, { status: 204 })
      },
    })
    await client.revokeDeviceBinding()
    expect(body).toEqual({})
  })
  it.each([
    [{ error: "invalid_token", app_error: "ACCOUNT_BANNED" }, 401, "ACCOUNT_BANNED"],
    [{ error: "invalid_token", app_error: "DEVICE_REVOKED" }, 401, "DEVICE_REVOKED"],
    [{ error: "insufficient_scope", app_error: "unknown_raw" }, 403, "insufficient_scope"],
    [{ code: "MEMBERSHIP_EXPIRED" }, 403, "MEMBERSHIP_EXPIRED"],
    [{ error: "temporarily_unavailable" }, 503, "temporarily_unavailable"],
  ] as const)(
    "preserves business errors without automatic refresh %#",
    async (body, status, code) => {
      let calls = 0
      const client = new PigclaudeApiClient({
        baseUrl,
        accessToken: async () => "access",
        fetcher: async () => {
          calls++
          return Response.json(body, { status })
        },
      })
      await expect(client.inspectMembership(input)).rejects.toMatchObject({ code, status })
      expect(calls).toBe(1)
    },
  )
  it("reports network failure without exposing the raw exception", async () => {
    const client = new PigclaudeApiClient({
      baseUrl,
      accessToken: async () => "access",
      fetcher: async () => {
        throw new Error("sensitive raw")
      },
    })
    await expect(client.inspectMembership(input)).rejects.toEqual(
      expect.objectContaining({ code: "SERVER_UNAVAILABLE" } satisfies Partial<PigclaudeApiError>),
    )
  })
  it.each(["headers", "body"])(
    "bounds stalled %s and recovers without a second client",
    async (phase) => {
      vi.useFakeTimers()
      try {
        let signal: AbortSignal | null | undefined
        let recover = false
        const client = new PigclaudeApiClient({
          baseUrl,
          accessToken: async () => "access",
          fetcher: async (url, init) => {
            signal = init?.signal
            if (recover)
              return Response.json(String(url).endsWith("/inspect") ? session : entitlement)
            if (phase === "headers") return new Promise<Response>(() => {})
            return new Response(new ReadableStream({ start() {} }))
          },
        })
        const pending = client.inspectMembership(input).catch((error: unknown) => error)
        await vi.advanceTimersByTimeAsync(15_000)
        expect(await pending).toMatchObject({ code: "SERVER_UNAVAILABLE" })
        expect(signal?.aborted).toBe(true)
        recover = true
        expect(await client.inspectMembership(input)).toMatchObject({ state: "active" })
      } finally {
        vi.useRealTimers()
      }
    },
  )
})

it("uses an explicitly captured token without waiting for a mutable vault provider", async () => {
  let reads = 0
  const sent: string[] = []
  const client = new PigclaudeApiClient({
    baseUrl,
    accessToken: async () => {
      reads++
      return new Promise<string>(() => {})
    },
    fetcher: async (_url, init) => {
      sent.push(new Headers(init?.headers).get("authorization") ?? "")
      return new Response(null, { status: 204 })
    },
  })
  await client.revokeDeviceBinding("original-account-token")
  expect(reads).toBe(0)
  expect(sent).toEqual(["Bearer original-account-token"])
})
