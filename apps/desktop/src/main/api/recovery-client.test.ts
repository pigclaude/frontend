// 负责验证独立恢复接口的原生 Bearer 合同，不发送网站 Cookie 或自报身份。
import { expect, it, vi } from "vitest"
import { PigclaudeApiClient } from "./pigclaude-api-client"

const deviceId = "pcd_" + "a".repeat(64)
const payload = {
  userId: "user-a",
  deviceId,
  bindingEpoch: "2",
  authVersion: "1",
  account: { userId: "user-a", nickname: "阿青", email: "a@example.test", avatar: "" },
  membership: {
    status: "expired",
    tier: { code: "vip", name: "VIP", level: 1 },
    validUntil: "2026-01-01T00:00:00Z",
  },
  grantExpiresAt: "2030-01-01T00:00:00Z",
  canRevoke: true,
}
it("reads only the bearer owner's recovery facts through the independent endpoint", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(payload))
  const client = new PigclaudeApiClient({ baseUrl: "https://api.example.test", fetcher })
  expect(await client.readRecovery("fixture-access")).toEqual(payload)
  expect(fetcher).toHaveBeenCalledWith(
    "https://api.example.test/v1/desktop/recovery",
    expect.objectContaining({
      method: "GET",
      credentials: "omit",
      redirect: "error",
      headers: { accept: "application/json", authorization: "Bearer fixture-access" },
    }),
  )
})

it.each(["wrong-owner", "unknown-status", "array-status", "bad-deadline"])(
  "rejects malformed recovery %s",
  async (kind) => {
    const value = structuredClone(payload)
    const input: unknown =
      kind === "wrong-owner"
        ? { ...value, account: { ...value.account, userId: "other" } }
        : kind === "unknown-status"
          ? { ...value, membership: { ...value.membership, status: "unknown" } }
          : kind === "array-status"
            ? { ...value, membership: { ...value.membership, status: ["expired"] } }
            : { ...value, grantExpiresAt: "not-a-date" }
    const client = new PigclaudeApiClient({
      baseUrl: "https://api.example.test",
      fetcher: async () => Response.json(input),
    })
    await expect(client.readRecovery("fixture-access")).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    })
  },
)
