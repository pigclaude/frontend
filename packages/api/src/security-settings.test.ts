// 负责通过真实 HTTP facade 验证设置路由、命令和脱敏边界。
import { expect, it } from "vitest"
import { createClient } from "./client"
import { createAdminApi } from "./admin/endpoints"
it("uses management routes and refuses secret-bearing responses", async () => {
  const requests: { path: string; method: string; body: unknown }[] = []
  const summary = {
    revision: "2",
    enabled: false,
    mode: "disabled",
    siteKey: null,
    hostnames: [],
    secretConfigured: true,
    updatedAt: "2026-10-18T00:00:00Z",
    updatedBy: "admin",
  }
  let leak = false
  const api = createAdminApi(
    createClient({
      fetch: async (path, init) => {
        requests.push({
          path: String(path),
          method: init?.method ?? "GET",
          body: init?.body ? (JSON.parse(String(init.body)) as unknown) : null,
        })
        return new Response(
          JSON.stringify(
            String(path).includes("audits")
              ? { items: [], nextCursor: null }
              : {
                  revision: "2",
                  active: { ...summary, ...(leak ? { secretKey: "leak" } : {}) },
                  draft: null,
                },
          ),
        )
      },
    }),
  )
  await api.settings.turnstile.get()
  await api.settings.turnstile.saveDraft({
    expectedRevision: "2",
    enabled: true,
    siteKey: "key",
    hostnames: ["admin.local"],
    secretKey: "",
  })
  await api.settings.turnstile.activate({ expectedRevision: "2", captchaToken: "proof" })
  await api.settings.turnstile.disable({ expectedRevision: "2", confirmed: true })
  await api.settings.turnstile.audits({ cursor: "2", limit: 20 })
  expect(requests.map(({ path, method }) => [method, path])).toEqual([
    ["GET", "/admin/v1/settings/turnstile"],
    ["PUT", "/admin/v1/settings/turnstile/draft"],
    ["POST", "/admin/v1/settings/turnstile/activate"],
    ["POST", "/admin/v1/settings/turnstile/disable"],
    ["GET", "/admin/v1/settings/turnstile/audits?cursor=2&limit=20"],
  ])
  expect(requests[1].body).toEqual({
    expectedRevision: "2",
    enabled: true,
    siteKey: "key",
    hostnames: ["admin.local"],
  })
  leak = true
  await expect(api.settings.turnstile.get()).rejects.toThrow()
})
