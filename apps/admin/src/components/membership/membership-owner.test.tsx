// 负责通过真实会员消费者与 HTTP facade 验证 bootstrap 和迟到写入的页面归属。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { GrantDialog } from "./grant-dialog"
import { MembersSection } from "./members-section"
const mocks = vi.hoisted(() => ({
  fetch: vi.fn<typeof fetch>(),
  success: vi.fn(),
  error: vi.fn(),
  granted: vi.fn(),
  close: vi.fn(),
}))
vi.mock("sonner", () => ({ toast: { success: mocks.success, error: mocks.error } }))
vi.mock("@/lib/api", async () => {
  const { createClient } = await import("@pigclaude/api/client")
  const { createAdminApi } = await import("@pigclaude/api/admin")
  return { adminApi: createAdminApi(createClient({ fetch: mocks.fetch })) }
})
const member = {
  userId: "u1",
  planId: "day",
  productCode: "pigclaude",
  planKind: "day",
  status: "active",
  lifetime: false,
  validUntil: null,
  termsVersion: "v1",
  termsAcceptedAt: null,
  entitlementVersion: "1",
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
function mount(kind: "grant" | "revoke", client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        {kind === "grant" ? (
          <GrantDialog open onOpenChange={mocks.close} onGranted={mocks.granted} />
        ) : (
          <MembersSection />
        )}
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
async function submit(kind: "grant" | "revoke") {
  if (kind === "grant") {
    fireEvent.change(screen.getByLabelText("用户 ID"), { target: { value: "u1" } })
    fireEvent.change(screen.getByLabelText("套餐 ID"), { target: { value: "day" } })
    fireEvent.change(screen.getByLabelText("操作备注"), { target: { value: "reviewed" } })
    fireEvent.click(screen.getByRole("button", { name: "确认授予" }))
  } else {
    fireEvent.click(await screen.findByRole("button", { name: "撤销" }))
    fireEvent.change(screen.getByLabelText("原因"), { target: { value: "reviewed" } })
    fireEvent.click(screen.getByRole("button", { name: "确认" }))
  }
}
function normal(url: RequestInfo | URL) {
  return String(url) === "/admin/v1/session"
    ? json({ csrf: "owner-csrf" })
    : json({ items: [member], nextCursor: "0" })
}
const writes = () => mocks.fetch.mock.calls.filter(([, init]) => init?.method === "POST")
beforeEach(() => {
  vi.clearAllMocks()
  mocks.fetch.mockImplementation(async (url) => normal(url))
})
afterEach(() => vi.restoreAllMocks())
describe("real membership operation ownership", () => {
  it.each(["grant", "revoke"] as const)(
    "does not start %s business HTTP if the page unmounts while bootstrap waits",
    async (kind) => {
      const bootstrap = deferred()
      mocks.fetch.mockImplementation(async (url, init) =>
        String(url) === "/admin/v1/session"
          ? bootstrap.promise
          : init?.method === "POST"
            ? json(member)
            : normal(url),
      )
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      const view = mount(kind, client)
      await submit(kind)
      await waitFor(() =>
        expect(mocks.fetch.mock.calls.some(([url]) => url === "/admin/v1/session")).toBe(true),
      )
      view.unmount()
      await act(async () => {
        bootstrap.resolve(json({ csrf: "old-csrf" }))
      })
      expect(writes()).toHaveLength(0)
      expect(mocks.success).not.toHaveBeenCalled()
      expect(mocks.error).not.toHaveBeenCalled()
    },
  )
  it.each([
    ["grant", "resolve"],
    ["grant", "reject"],
    ["revoke", "resolve"],
    ["revoke", "reject"],
  ] as const)(
    "ignores old %s %s after the business request was already sent and a new page is pending",
    async (kind, outcome) => {
      const old = deferred(),
        next = deferred()
      let business = 0
      mocks.fetch.mockImplementation(async (url, init) =>
        init?.method === "POST" ? (++business === 1 ? old.promise : next.promise) : normal(url),
      )
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      const view = mount(kind, client)
      await submit(kind)
      await waitFor(() => expect(business).toBe(1))
      view.unmount()
      mount(kind, client)
      await submit(kind)
      await waitFor(() => expect(business).toBe(2))
      client.setQueryData(["admin-memberships", "latest"], {
        items: [{ ...member, entitlementVersion: "9" }],
        nextCursor: "0",
      })
      const invalidate = vi.spyOn(client, "invalidateQueries")
      const events = vi.spyOn(window, "dispatchEvent")
      await act(async () => {
        old.resolve(
          outcome === "resolve" ? json(member) : json({ reason: "OLD_OPERATION_FAILURE" }, 503),
        )
      })
      expect(invalidate).not.toHaveBeenCalled()
      expect(
        events.mock.calls.filter(([event]) => event.type === "pigclaude:admin-membership"),
      ).toHaveLength(0)
      expect(mocks.success).not.toHaveBeenCalled()
      expect(mocks.error).not.toHaveBeenCalled()
      expect(mocks.granted).not.toHaveBeenCalled()
      expect(mocks.close).not.toHaveBeenCalled()
      const confirm = screen.getByRole("button", { name: "提交中…" })
      expect(confirm.hasAttribute("disabled")).toBe(true)
      expect(client.getQueryState(["admin-memberships", "latest"])?.isInvalidated).toBe(false)
      await act(async () => {
        next.resolve(json({ ...member, entitlementVersion: "10" }))
      })
      invalidate.mockRestore()
      events.mockRestore()
    },
  )
})
