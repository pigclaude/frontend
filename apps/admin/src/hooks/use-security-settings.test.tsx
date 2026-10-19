// 负责通过真实权限 hook 与 QueryClient 验证写入的脱敏缓存和权限拒绝。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import type { ReactNode } from "react"
import { expect, it, vi } from "vitest"
import { useSecuritySettings } from "./use-security-settings"
const mocks = vi.hoisted(() => ({ fetch: vi.fn<typeof fetch>() }))
vi.mock("@/lib/api", async () => {
  const { createClient } = await import("@pigclaude/api/client")
  const { createAdminApi } = await import("@pigclaude/api/admin")
  return { adminApi: createAdminApi(createClient({ fetch: mocks.fetch })) }
})
it("does not persist write secrets and refuses malformed responses before caching", async () => {
  const summary = {
    revision: "2",
    enabled: false,
    mode: "disabled",
    siteKey: null,
    hostnames: [],
    secretConfigured: false,
    updatedAt: "2026-10-18T00:00:00Z",
    updatedBy: "ops",
  }
  const view = { revision: "2", active: summary, draft: null }
  let malformed = false
  mocks.fetch.mockImplementation(async (url) =>
    String(url) === "/admin/v1/session"
      ? new Response(JSON.stringify({ csrf: "csrf" }))
      : new Response(
          JSON.stringify(
            String(url).includes("audits")
              ? { items: [], nextCursor: null }
              : { ...view, ...(malformed ? { encryptedSecret: "leak" } : {}) },
          ),
        ),
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(["admin-me"], {
    status: "active",
    permissions: ["settings:read", "settings:write"],
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  )
  const { result } = renderHook(useSecuritySettings, { wrapper })
  await waitFor(() => expect(result.current.query.data).toEqual(view))
  await act(async () => {
    await result.current.save({
      expectedRevision: "2",
      enabled: true,
      siteKey: "candidate",
      hostnames: ["admin.local"],
      secretKey: "ephemeral-secret",
    })
  })
  expect(client.getMutationCache().getAll()).toHaveLength(0)
  expect(
    JSON.stringify(
      client
        .getQueryCache()
        .getAll()
        .map((query) => query.state.data),
    ),
  ).not.toContain("ephemeral-secret")
  malformed = true
  await act(async () => {
    await expect(
      result.current.save({ expectedRevision: "2", enabled: false, siteKey: "", hostnames: [] }),
    ).rejects.toThrow("设置响应格式无效")
  })
  expect(client.getQueryData(["security-settings"])).toEqual(view)
})
