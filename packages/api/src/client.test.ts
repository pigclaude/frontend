// 负责验证共享 HTTP client 对管理员 204 退出响应和 401 回调的协议处理。
import { describe, expect, it, vi } from "vitest"
import { createClient } from "./client"

describe("createClient", () => {
  it("keeps numeric legacy envelopes and explicit reason/message/metadata unchanged", async () => {
    const client = createClient({
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: 1007,
            reason: "OLD_AUTH_REASON",
            message: "原凭据错误",
            metadata: { field: "password" },
          }),
          { status: 400 },
        ),
      ),
    })
    await expect(client.post("/legacy/login")).rejects.toMatchObject({
      status: 400,
      code: 1007,
      reason: "OLD_AUTH_REASON",
      message: "原凭据错误",
      metadata: { field: "password" },
    })
  })

  it("accepts an empty 204 response for admin logout", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }))
    const client = createClient({ fetch: fetcher })
    await expect(client.post<Record<string, never>>("/admin/v1/auth/logout")).resolves.toEqual({})
  })

  it("calls onUnauthorized and preserves the 401 reason", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({ code: "UNAUTHORIZED", reason: "expired", message: "expired" }),
        {
          status: 401,
          headers: { "content-type": "application/json" },
        },
      ),
    )
    const onUnauthorized = vi.fn()
    const client = createClient({ fetch: fetcher, onUnauthorized })
    await expect(client.get("/admin/v1/me")).rejects.toMatchObject({
      status: 401,
      reason: "expired",
    })
    expect(onUnauthorized).toHaveBeenCalledOnce()
  })
})
