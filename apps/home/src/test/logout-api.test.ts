// 负责验证 home 退出 facade 使用真实 RP bootstrap CSRF 与固定同源退出。
import { afterEach, describe, expect, it, vi } from "vitest"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe("home logout API facade", () => {
  it("posts to the Rust logout endpoint with session cookies and accepts 204", async () => {
    vi.resetModules()
    const requestFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            principalId: "u-1",
            principalType: "User",
            authVersion: "1",
            csrf: "synthetic-csrf",
            permissions: [],
          }),
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal("fetch", requestFetch)
    const { homeApi } = await import("@/lib/api")
    await homeApi.auth.logout()
    expect(requestFetch).toHaveBeenCalledTimes(2)
    expect(requestFetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/v1\/web\/oidc\/logout$/),
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ csrf: "synthetic-csrf" }),
      }),
    )
  })
})

it("does not send the next logout HTTP stage after the initiating UI loses ownership", async () => {
  vi.resetModules()
  let complete: (value: Response) => void = () => {}
  const fetcher = vi.fn<typeof fetch>((_url, init) =>
    init?.method === "POST"
      ? Promise.resolve(new Response(null, { status: 204 }))
      : new Promise((resolve) => {
          complete = resolve
        }),
  )
  vi.stubGlobal("fetch", fetcher)
  const { homeApi } = await import("@/lib/api")
  let current = true
  const request = homeApi.auth.logout(() => current)
  const assertion = expect(request).rejects.toMatchObject({ name: "StaleSessionResponse" })
  current = false
  complete(new Response(JSON.stringify({ csrf: "previous-session" })))
  await assertion
  expect(fetcher).toHaveBeenCalledTimes(1)
})
