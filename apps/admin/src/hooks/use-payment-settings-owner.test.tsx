// 负责支付直接命令在路由、会话和权限失效后的 HTTP、缓存及秘密隔离。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import { MemoryRouter, useNavigate } from "react-router"
import type { ReactNode } from "react"
import { beforeEach, expect, it, vi } from "vitest"
import { usePaymentSettings } from "./use-payment-settings"
import { adminSessionGeneration } from "@/lib/session-generation"
const mocks = vi.hoisted(() => ({ fetch: vi.fn<typeof fetch>() }))
vi.mock("@/lib/api", async () => {
  const { createClient } = await import("@pigclaude/api/client")
  const { createAdminApi } = await import("@pigclaude/api/admin")
  return { adminApi: createAdminApi(createClient({ fetch: mocks.fetch })) }
})
const settings = {
  revision: "2",
  enabled: true,
  gatewayUrl: "https://pay.test",
  pid: "pid",
  keyConfigured: true,
  payTypes: ["alipay" as const],
  notifyBaseUrl: "https://home.test",
}
const draft = { ...settings, expectedRevision: "2", key: "ephemeral-secret" }
function deferred() {
  let resolve: (value: Response) => void = () => {}
  const promise = new Promise<Response>((accept) => {
    resolve = accept
  })
  return { promise, resolve }
}
function normal(url: RequestInfo | URL) {
  return Response.json(
    String(url).endsWith("/session")
      ? { csrf: "csrf" }
      : String(url).includes("audits")
        ? { items: [], nextCursor: null }
        : settings,
  )
}
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(["admin-me"], {
    id: "ops",
    status: "active",
    permissions: ["payment:read", "payment:settings:write"],
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  )
  return {
    client,
    ...renderHook(() => ({ settings: usePaymentSettings(), navigate: useNavigate() }), { wrapper }),
  }
}
beforeEach(() => mocks.fetch.mockReset().mockImplementation(async (url) => normal(url)))
it("does not send payment PUT after unmount during csrf bootstrap", async () => {
  const pending = deferred()
  mocks.fetch.mockImplementation(async (url) =>
    String(url).endsWith("/session") ? pending.promise : normal(url),
  )
  const view = mount()
  await waitFor(() => expect(view.result.current.settings.query.data).toBeTruthy())
  let request: Promise<unknown> = Promise.resolve()
  act(() => {
    request = view.result.current.settings.save(draft).catch((e: unknown) => e)
  })
  view.unmount()
  await act(async () => {
    pending.resolve(Response.json({ csrf: "old" }))
    await request
  })
  expect(mocks.fetch.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(0)
  expect(view.client.getMutationCache().getAll()).toHaveLength(0)
})
it.each(["route", "permission", "session"])(
  "ignores late payment response after %s changes",
  async (reason) => {
    const pending = deferred()
    mocks.fetch.mockImplementation(async (url, init) =>
      init?.method === "PUT" ? pending.promise : normal(url),
    )
    const view = mount()
    await waitFor(() => expect(view.result.current.settings.query.isFetching).toBe(false))
    let request: Promise<unknown> = Promise.resolve()
    act(() => {
      request = view.result.current.settings.save(draft).catch((e: unknown) => e)
    })
    await waitFor(() =>
      expect(mocks.fetch.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(true),
    )
    await act(async () => {
      if (reason === "route") view.result.current.navigate("/other")
      else if (reason === "permission")
        view.client.setQueryData(["admin-me"], {
          id: "ops",
          status: "active",
          permissions: ["payment:read"],
        })
      else adminSessionGeneration.invalidate()
    })
    await act(async () => {
      pending.resolve(Response.json({ ...settings, revision: "3" }))
      await request
    })
    expect(view.client.getQueryData(["payment-settings", "ops"])).toEqual(settings)
    expect(view.result.current.settings.error).toBe("")
    expect(
      JSON.stringify(
        view.client
          .getQueryCache()
          .getAll()
          .map((q) => q.state),
      ),
    ).not.toContain("ephemeral-secret")
    expect(view.client.getMutationCache().getAll()).toHaveLength(0)
  },
)
