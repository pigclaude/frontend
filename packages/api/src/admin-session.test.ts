// 负责真实共享客户端的管理员 RP 退出、既有写入 CSRF 与迟到响应隔离。
import { describe, expect, it, vi } from "vitest"
import { createClient } from "./client"
import { createAdminApi } from "./admin/endpoints"
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status })
}
describe("admin RP client", () => {
  it("loads session-bound CSRF per existing membership mutation without modifying DTO", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url) =>
        String(url) === "/admin/v1/session"
          ? json({ csrf: "real-csrf", principalType: "Admin" })
          : json({}),
      )
    const api = createAdminApi(createClient({ fetch: fetcher }))
    await api.membership.grant({ userId: "u1", planId: "day", termsVersion: "v1", remark: "ok" })
    await api.membership.revoke({ userId: "u1", reason: "remove" })
    const writes = fetcher.mock.calls.filter(([, init]) => init?.method === "POST")
    expect(writes).toHaveLength(2)
    for (const [, init] of writes)
      expect(new Headers(init?.headers).get("X-CSRF-Token")).toBe("real-csrf")
    expect(JSON.parse(String(writes[1][1]?.body))).toEqual({ reason: "remove" })
    expect(fetcher.mock.calls.filter(([url]) => url === "/admin/v1/session")).toHaveLength(2)
  })
  it("logs out only through Admin RP with bootstrap csrf", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url) =>
        String(url) === "/admin/v1/session"
          ? json({ csrf: "rp-csrf" })
          : new Response(null, { status: 204 }),
      )
    await createAdminApi(createClient({ fetch: fetcher })).auth.logout()
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "/admin/v1/session",
      "/admin/v1/web/oidc/logout",
    ])
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual({ csrf: "rp-csrf" })
  })
  it.each([200, 401])(
    "rejects late %s results before delivering identity or unauthorized effects",
    async (status) => {
      let generation = 0
      let resolve: (response: Response) => void = () => {}
      const options = {
        fetch: vi.fn<typeof fetch>(
          () =>
            new Promise((accept) => {
              resolve = accept
            }),
        ),
        generation: () => generation,
        onUnauthorized: vi.fn(),
      }
      const client = createClient(options)
      const request = client.get("/admin/v1/me")
      const assertion = expect(request).rejects.toMatchObject({ name: "StaleSessionResponse" })
      generation++
      resolve(json({ id: "old-user" }, status))
      await assertion
      expect(options.onUnauthorized).not.toHaveBeenCalled()
    },
  )
})

it("does not send Admin logout after its UI owner leaves during bootstrap", async () => {
  let complete: (value: Response) => void = () => {}
  const fetcher = vi.fn<typeof fetch>((_url, init) =>
    init?.method === "POST"
      ? Promise.resolve(new Response(null, { status: 204 }))
      : new Promise((resolve) => {
          complete = resolve
        }),
  )
  let current = true
  const api = createAdminApi(createClient({ fetch: fetcher }))
  const request = api.auth.logout(() => current)
  const assertion = expect(request).rejects.toMatchObject({ name: "StaleSessionResponse" })
  current = false
  complete(json({ csrf: "previous-session" }))
  await assertion
  expect(fetcher).toHaveBeenCalledTimes(1)
})
