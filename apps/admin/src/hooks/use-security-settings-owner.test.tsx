// 负责通过真实设置消费者与 HTTP facade 验证三个写入口的 owner、cache 和 pending 隔离。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import { MemoryRouter, useNavigate } from "react-router"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useSecuritySettings } from "./use-security-settings"
const mocks = vi.hoisted(() => ({ fetch: vi.fn<typeof fetch>() }))
vi.mock("@/lib/api", async () => {
  const { createClient } = await import("@pigclaude/api/client")
  const { createAdminApi } = await import("@pigclaude/api/admin")
  return { adminApi: createAdminApi(createClient({ fetch: mocks.fetch })) }
})
function settings(revision = "2") {
  return {
    revision,
    active: {
      revision,
      enabled: true,
      mode: "required",
      siteKey: "site",
      hostnames: ["admin.local"],
      secretConfigured: true,
      updatedAt: "2026-10-18T00:00:00Z",
      updatedBy: "ops",
    },
    draft: null,
  }
}
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status })
}
function deferred() {
  let resolve: (value: Response) => void = () => {}
  const promise = new Promise<Response>((accept) => {
    resolve = accept
  })
  return { promise, resolve }
}
function normal(url: RequestInfo | URL) {
  return String(url) === "/admin/v1/session"
    ? json({ csrf: "settings-owner-csrf" })
    : String(url).includes("audits")
      ? json({ items: [], nextCursor: null })
      : json(settings())
}
function mount(client: QueryClient) {
  client.setQueryData(["admin-me"], {
    id: "a1",
    account: "ops",
    status: "active",
    permissions: ["settings:read", "settings:write"],
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/settings"]}>{children}</MemoryRouter>
    </QueryClientProvider>
  )
  return renderHook(() => ({ settings: useSecuritySettings(), navigate: useNavigate() }), {
    wrapper,
  })
}
const draft = {
  expectedRevision: "2",
  enabled: true,
  siteKey: "site",
  hostnames: ["admin.local"],
  secretKey: "ephemeral-secret",
}
type SettingsConsumer = ReturnType<typeof useSecuritySettings>
function start(consumer: SettingsConsumer, method: "save" | "activate" | "disable") {
  return method === "save"
    ? consumer.save(draft)
    : method === "activate"
      ? consumer.activate("ephemeral-proof")
      : consumer.disable()
}
const writes = () =>
  mocks.fetch.mock.calls.filter(([, init]) => init?.method === "POST" || init?.method === "PUT")
beforeEach(() => {
  mocks.fetch.mockReset().mockImplementation(async (url) => normal(url))
})
describe("real settings operation ownership", () => {
  it.each(["save", "activate", "disable"] as const)(
    "does not start %s business HTTP after unmount before bootstrap returns",
    async (method) => {
      const bootstrap = deferred()
      mocks.fetch.mockImplementation(async (url, init) =>
        String(url) === "/admin/v1/session"
          ? bootstrap.promise
          : init?.method === "POST" || init?.method === "PUT"
            ? json(settings("3"))
            : normal(url),
      )
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      const view = mount(client)
      await waitFor(() => expect(view.result.current.settings.query.isFetching).toBe(false))
      let request: Promise<unknown> = Promise.resolve()
      act(() => {
        request = start(view.result.current.settings, method).catch((reason: unknown) => reason)
      })
      await waitFor(() =>
        expect(mocks.fetch.mock.calls.some(([url]) => url === "/admin/v1/session")).toBe(true),
      )
      view.unmount()
      await act(async () => {
        bootstrap.resolve(json({ csrf: "old-csrf" }))
        await request
      })
      expect(writes()).toHaveLength(0)
      expect(client.getQueryData(["security-settings"])).toEqual(settings())
      expect(client.getMutationCache().getAll()).toHaveLength(0)
    },
  )
  it.each(["resolve", "reject"] as const)(
    "ignores old %s/cache/error/finally after route changes and a new settings operation is pending",
    async (outcome) => {
      const old = deferred(),
        next = deferred()
      let business = 0
      mocks.fetch.mockImplementation(async (url, init) =>
        init?.method === "POST" || init?.method === "PUT"
          ? ++business === 1
            ? old.promise
            : next.promise
          : normal(url),
      )
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      const view = mount(client)
      await waitFor(() => expect(view.result.current.settings.query.isFetching).toBe(false))
      let oldRequest: Promise<unknown> = Promise.resolve(),
        nextRequest: Promise<unknown> = Promise.resolve()
      act(() => {
        oldRequest = view.result.current.settings.save(draft).catch((reason: unknown) => reason)
      })
      await waitFor(() => expect(business).toBe(1))
      await act(async () => {
        view.result.current.navigate("/settings?view=new")
        client.setQueryData(["security-settings"], settings("9"))
      })
      act(() => {
        nextRequest = view.result.current.settings.disable().catch((reason: unknown) => reason)
      })
      await waitFor(() => expect(business).toBe(2))
      await act(async () => {
        old.resolve(
          outcome === "resolve" ? json(settings("3")) : json({ code: "SETTINGS_UNAVAILABLE" }, 503),
        )
        await oldRequest
      })
      expect(client.getQueryData(["security-settings"])).toEqual(settings("9"))
      expect(view.result.current.settings.error).toBeNull()
      expect(view.result.current.settings.busy).toBe(true)
      expect(JSON.stringify(client.getMutationCache().getAll())).not.toContain("ephemeral-secret")
      await act(async () => {
        next.resolve(json(settings("10")))
        await nextRequest
      })
    },
  )
})

it("does not overwrite the new page cache with an old settings response already in flight", async () => {
  const old = deferred()
  mocks.fetch.mockImplementation(async (url, init) =>
    init?.method === "PUT" ? old.promise : normal(url),
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const first = mount(client)
  await waitFor(() => expect(first.result.current.settings.query.isFetching).toBe(false))
  let request: Promise<unknown> = Promise.resolve()
  act(() => {
    request = first.result.current.settings.save(draft).catch((reason: unknown) => reason)
  })
  await waitFor(() => expect(writes()).toHaveLength(1))
  first.unmount()
  const next = mount(client)
  await waitFor(() => expect(next.result.current.settings.query.isFetching).toBe(false))
  await act(async () => {
    client.setQueryData(["security-settings"], settings("9"))
  })
  const invalidate = vi.spyOn(client, "invalidateQueries")
  await act(async () => {
    old.resolve(json(settings("3")))
    await request
  })
  expect(client.getQueryData(["security-settings"])).toEqual(settings("9"))
  expect(invalidate).not.toHaveBeenCalled()
  invalidate.mockRestore()
})
it("stops the settings chain if the website session generation changes during bootstrap", async () => {
  const { adminSessionGeneration } = await import("@/lib/session-generation")
  const bootstrap = deferred()
  mocks.fetch.mockImplementation(async (url, init) =>
    String(url) === "/admin/v1/session"
      ? bootstrap.promise
      : init?.method === "PUT"
        ? json(settings("3"))
        : normal(url),
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = mount(client)
  await waitFor(() => expect(view.result.current.settings.query.isFetching).toBe(false))
  let request: Promise<unknown> = Promise.resolve()
  act(() => {
    request = view.result.current.settings.save(draft).catch((reason: unknown) => reason)
  })
  await waitFor(() =>
    expect(mocks.fetch.mock.calls.some(([url]) => url === "/admin/v1/session")).toBe(true),
  )
  adminSessionGeneration.invalidate()
  await act(async () => {
    bootstrap.resolve(json({ csrf: "old-csrf" }))
    await request
  })
  expect(writes()).toHaveLength(0)
})
