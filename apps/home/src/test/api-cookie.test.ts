// 负责验证 home client 使用 cookie，并在 401 时触发统一会话恢复回调。
import { describe, expect, it, vi } from "vitest"
import { createClient } from "@pigclaude/api"

describe("home HTTP client options", () => {
  it("sends include credentials and invokes unauthorized recovery", async () => {
    const onUnauthorized = vi.fn()
    const requestFetch = vi.fn(
      async () => new Response(JSON.stringify({ message: "expired" }), { status: 401 }),
    )
    const client = createClient({ fetch: requestFetch, credentials: "include", onUnauthorized })
    await expect(client.get("/v1/user/me")).rejects.toMatchObject({ status: 401 })
    expect(requestFetch).toHaveBeenCalledWith(
      "/v1/user/me",
      expect.objectContaining({ credentials: "include" }),
    )
    expect(onUnauthorized).toHaveBeenCalledOnce()
  })
})
