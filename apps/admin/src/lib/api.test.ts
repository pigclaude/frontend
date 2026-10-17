// 负责验证管理后台 HTTP client 注入 onUnauthorized，使 401 不只停留在错误 toast。
import { afterEach, describe, expect, it, vi } from "vitest"

const redirectToLogin = vi.hoisted(() => vi.fn())
vi.mock("@/lib/navigation", () => ({ redirectToLogin }))

describe("admin API auth wiring", () => {
  afterEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
    redirectToLogin.mockReset()
  })

  it("wires the admin client 401 callback to login recovery", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ code: "UNAUTHORIZED", reason: "expired" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    )
    vi.stubGlobal("fetch", fetcher)
    const { adminApi } = await import("./api")

    await expect(adminApi.me()).rejects.toMatchObject({ status: 401 })
    expect(redirectToLogin).toHaveBeenCalledOnce()
  })
})
