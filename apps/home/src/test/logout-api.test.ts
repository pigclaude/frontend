// 负责验证 home 退出 facade 使用既有 cookie client 和真实 Rust 退出端点。
import { afterEach, describe, expect, it, vi } from "vitest"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe("home logout API facade", () => {
  it("posts to the Rust logout endpoint with session cookies and accepts 204", async () => {
    vi.resetModules()
    const requestFetch = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal("fetch", requestFetch)
    const { homeApi } = await import("@/lib/api")
    await homeApi.auth.logout()
    expect(requestFetch).toHaveBeenCalledOnce()
    expect(requestFetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/v1\/auth\/logout$/),
      expect.objectContaining({ method: "POST", credentials: "include" }),
    )
  })
})
