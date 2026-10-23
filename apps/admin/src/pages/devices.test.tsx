// 负责验证仅设备权限的已知用户入口、设备 envelope、精确撤销和异步归属。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { DevicesSection } from "@/components/membership/devices-section"
const mocks = vi.hoisted(() => ({
  fetch: vi.fn<typeof fetch>(),
  permissions: ["device:read", "device:revoke"],
}))
vi.mock("@/lib/api", async () => {
  const { createClient } = await import("@pigclaude/api/client")
  const { createAdminApi } = await import("@pigclaude/api/admin")
  return { adminApi: createAdminApi(createClient({ fetch: mocks.fetch })) }
})
const id = "pcd_" + "a".repeat(64)
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status })
}
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return {
    client,
    ...render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <DevicesSection />
        </QueryClientProvider>
      </MemoryRouter>,
    ),
  }
}
async function load() {
  fireEvent.change(await screen.findByLabelText("设备用户筛选"), { target: { value: "42" } })
  fireEvent.click(screen.getByRole("button", { name: "筛选" }))
  await screen.findByText("用户私有名称")
}
beforeEach(() => {
  mocks.permissions = ["device:read", "device:revoke"]
  mocks.fetch.mockReset().mockImplementation(async (url) => {
    if (String(url) === "/admin/v1/me")
      return json({
        id: "a1",
        account: "device operator",
        status: "active",
        permissions: mocks.permissions,
      })
    if (String(url).startsWith("/admin/v1/users/42/devices"))
      return json({
        authVersion: "9007199254740993",
        devices: [
          {
            deviceId: id,
            displayName: "用户私有名称",
            platform: "linux",
            status: "active",
            bindingEpoch: "9007199254740995",
            firstAuthorizedAt: "2026-10-18T00:00:00Z",
            lastSeenAt: null,
            isCurrentDevice: null,
          },
        ],
      })
    if (String(url) === "/admin/v1/session") return json({ csrf: "admin-csrf" })
    return json({ items: [], nextCursor: "0" })
  })
})
afterEach(cleanup)
it("allows known user ID without users:read and submits both exact envelope versions", async () => {
  const original = mocks.fetch.getMockImplementation()!
  mocks.fetch.mockImplementation(async (url, init) =>
    String(url).endsWith("/revoke") ? new Response(null, { status: 204 }) : original(url, init),
  )
  mount()
  await load()
  expect(mocks.fetch.mock.calls.some(([url]) => String(url).startsWith("/admin/v1/users?"))).toBe(
    false,
  )
  fireEvent.click(screen.getByRole("button", { name: "撤销 用户私有名称" }))
  fireEvent.change(screen.getByLabelText("操作原因"), { target: { value: "  指定关系  " } })
  fireEvent.click(screen.getByRole("button", { name: "确认撤销" }))
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  const call = mocks.fetch.mock.calls.find(([url]) => String(url).endsWith("/revoke"))!
  expect(call[0]).toBe(`/admin/v1/users/42/devices/${id}/revoke`)
  expect(JSON.parse(String(call[1]?.body))).toEqual({
    csrf: "admin-csrf",
    expectedAuthVersion: "9007199254740993",
    expectedBindingEpoch: "9007199254740995",
    reason: "  指定关系  ",
  })
})
it("hides revoke from read-only and wildcard permissions", async () => {
  mocks.permissions = ["device:read", "device:*", "admin:*"]
  mount()
  await load()
  expect(screen.queryByRole("button", { name: "撤销 用户私有名称" })).toBeNull()
})
it("does not request devices without exact device:read", async () => {
  mocks.permissions = ["users:read", "device:*"]
  mount()
  expect((await screen.findByRole("alert")).textContent).toContain("权限")
  expect(mocks.fetch.mock.calls.some(([url]) => String(url).includes("/devices"))).toBe(false)
})
it("ignores an old bootstrap after the device consumer unmounts", async () => {
  let complete: (response: Response) => void = () => {}
  const original = mocks.fetch.getMockImplementation()!
  mocks.fetch.mockImplementation(async (url, init) =>
    String(url) === "/admin/v1/session"
      ? new Promise<Response>((resolve) => {
          complete = resolve
        })
      : original(url, init),
  )
  const view = mount()
  await load()
  fireEvent.click(screen.getByRole("button", { name: "撤销 用户私有名称" }))
  fireEvent.change(screen.getByLabelText("操作原因"), { target: { value: "reason" } })
  fireEvent.click(screen.getByRole("button", { name: "确认撤销" }))
  await waitFor(() =>
    expect(mocks.fetch.mock.calls.some(([url]) => String(url) === "/admin/v1/session")).toBe(true),
  )
  view.unmount()
  complete(json({ csrf: "old" }))
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(mocks.fetch.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false)
})

it("refreshes stale CAS state without replaying or showing successful revoke", async () => {
  let reads = 0
  const original = mocks.fetch.getMockImplementation()!
  mocks.fetch.mockImplementation(async (url, init) => {
    if (String(url).endsWith("/revoke")) return json({ error: "binding_conflict" }, 409)
    if (String(url).includes("/users/42/devices")) reads++
    return original(url, init)
  })
  mount()
  await load()
  fireEvent.click(screen.getByRole("button", { name: "撤销 用户私有名称" }))
  fireEvent.change(screen.getByLabelText("操作原因"), { target: { value: "reason" } })
  fireEvent.click(screen.getByRole("button", { name: "确认撤销" }))
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  expect((await screen.findByRole("alert")).textContent).toContain("已变化")
  await waitFor(() => expect(reads).toBe(2))
  expect(mocks.fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1)
  expect(screen.queryByText("指定设备关系已撤销，该账号的其他设备保持原状。")).toBeNull()
})
it.each(["success", "failure"])(
  "ignores late device %s without invalidating new cache or dispatching an event",
  async (outcome) => {
    let complete: (value: Response) => void = () => {}
    const original = mocks.fetch.getMockImplementation()!
    mocks.fetch.mockImplementation(async (url, init) =>
      String(url).endsWith("/revoke")
        ? new Promise<Response>((resolve) => {
            complete = resolve
          })
        : original(url, init),
    )
    const view = mount()
    const invalidate = vi.spyOn(view.client, "invalidateQueries")
    const event = vi.fn()
    window.addEventListener("pigclaude:admin-device", event)
    await load()
    fireEvent.click(screen.getByRole("button", { name: "撤销 用户私有名称" }))
    fireEvent.change(screen.getByLabelText("操作原因"), { target: { value: "reason" } })
    fireEvent.click(screen.getByRole("button", { name: "确认撤销" }))
    await waitFor(() =>
      expect(mocks.fetch.mock.calls.some(([url]) => String(url).endsWith("/revoke"))).toBe(true),
    )
    view.unmount()
    view.client.setQueryData(["next-session"], { id: "next" })
    complete(
      outcome === "success"
        ? new Response(null, { status: 204 })
        : json({ error: "access_denied" }, 403),
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(invalidate).not.toHaveBeenCalled()
    expect(event).not.toHaveBeenCalled()
    expect(view.client.getQueryData(["next-session"])).toEqual({ id: "next" })
    window.removeEventListener("pigclaude:admin-device", event)
  },
)

it("does not proceed past bootstrap if live device permission changes", async () => {
  let complete: (response: Response) => void = () => {}
  const original = mocks.fetch.getMockImplementation()!
  mocks.fetch.mockImplementation(async (url, init) =>
    String(url) === "/admin/v1/session"
      ? new Promise<Response>((resolve) => {
          complete = resolve
        })
      : original(url, init),
  )
  const view = mount()
  await load()
  fireEvent.click(screen.getByRole("button", { name: "撤销 用户私有名称" }))
  fireEvent.change(screen.getByLabelText("操作原因"), { target: { value: "reason" } })
  fireEvent.click(screen.getByRole("button", { name: "确认撤销" }))
  await waitFor(() =>
    expect(mocks.fetch.mock.calls.some(([url]) => String(url) === "/admin/v1/session")).toBe(true),
  )
  view.client.setQueryData(["admin-me"], {
    id: "a1",
    account: "operator",
    status: "active",
    permissions: ["device:read"],
  })
  await waitFor(() => expect(screen.queryByRole("button", { name: "提交中…" })).toBeNull())
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  complete(json({ csrf: "old" }))
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(mocks.fetch.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false)
})

it("shows a permission skeleton instead of bare loading text", () => {
  mocks.fetch.mockReturnValue(new Promise<Response>(() => {}))
  mount()
  const status = screen.getByRole("status", { name: "正在读取管理员权限" })
  expect(status.querySelector('[data-slot="skeleton"]')).toBeTruthy()
  expect(screen.queryByText("正在读取管理员权限…")).toBeNull()
})
