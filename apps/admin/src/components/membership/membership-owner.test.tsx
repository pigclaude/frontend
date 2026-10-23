// 负责通过真实会员消费者与 HTTP facade 验证 bootstrap 和迟到写入的页面归属。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { GrantDialog } from "./grant-dialog"
import { setupPickerDom, fillGrant } from "./grant-test-support"
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
  const adminApi = createAdminApi(createClient({ fetch: mocks.fetch }))
  adminApi.membership.grants.preview = async () => ({
    tier: { code: "vip", name: "VIP", level: 1, cardStyle: "azure" },
    validUntil: "2026-12-01T00:00:00Z",
    voidedRemainingSeconds: "0",
    voidedValueFen: "0",
    convertedSeconds: "0",
  })
  return { adminApi }
})
const member = {
  userId: "u1",
  status: "active",
  email: "member@example.test",
  tier: { code: "vip", name: "VIP", level: 1, cardStyle: "azure" },
  validUntil: "2026-10-30T00:00:00Z",
  entitlementVersion: "1",
}
const entitlement = {
  status: "active",
  tier: member.tier,
  validUntil: member.validUntil,
  remainingSeconds: "86400",
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
    await fillGrant("reviewed")
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "确认授予" }).hasAttribute("disabled")).toBe(false),
    )
    fireEvent.click(screen.getByRole("button", { name: "确认授予" }))
  } else {
    fireEvent.click(await screen.findByRole("button", { name: "撤销" }))
    fireEvent.change(screen.getByLabelText("原因"), { target: { value: "reviewed" } })
    fireEvent.click(screen.getByRole("button", { name: "确认" }))
  }
}
function normal(url: RequestInfo | URL) {
  if (String(url).includes("/membership/tiers"))
    return json({ items: [{ id: "day", name: "VIP", enabled: true }] })
  if (String(url).includes("/membership/users"))
    return json({
      items: [
        {
          userId: "u1",
          email: "member@example.test",
          tier: null,
          validUntil: null,
          status: "none",
        },
      ],
    })
  return String(url) === "/admin/v1/session"
    ? json({ csrf: "owner-csrf" })
    : json({ items: [member], nextCursor: null })
}
const writes = () => mocks.fetch.mock.calls.filter(([, init]) => init?.method === "POST")
setupPickerDom()
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
            ? json(entitlement)
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
        nextCursor: null,
      })
      const invalidate = vi.spyOn(client, "invalidateQueries")
      const events = vi.spyOn(window, "dispatchEvent")
      await act(async () => {
        old.resolve(
          outcome === "resolve"
            ? json(entitlement)
            : json({ reason: "OLD_OPERATION_FAILURE" }, 503),
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
        next.resolve(json({ ...entitlement, entitlementVersion: "10" }))
      })
      invalidate.mockRestore()
      events.mockRestore()
    },
  )
})
