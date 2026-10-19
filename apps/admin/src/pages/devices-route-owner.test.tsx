// 负责真实 Router history 切账号时的设备选择、确认、迟到请求及反馈归属回归。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { DevicesSection } from "@/components/membership/devices-section"
const mocks = vi.hoisted(() => ({ fetch: vi.fn<typeof fetch>() }))
vi.mock("@/lib/api", async () => {
  const { createClient } = await import("@pigclaude/api/client")
  const { createAdminApi } = await import("@pigclaude/api/admin")
  return { adminApi: createAdminApi(createClient({ fetch: mocks.fetch })) }
})
const id = "pcd_" + "a".repeat(64)
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status })
}
function normal(url: RequestInfo | URL) {
  if (String(url) === "/admin/v1/me")
    return json({
      id: "a1",
      account: "device operator",
      status: "active",
      permissions: ["device:read", "device:revoke"],
    })
  if (String(url) === "/admin/v1/session") return json({ csrf: "server-csrf" })
  const target = String(url).includes("/users/1/") ? "A" : "B"
  return json({
    authVersion: "1",
    devices: [
      {
        deviceId: id,
        displayName: `${target}私有名`,
        platform: "linux",
        status: "active",
        bindingEpoch: "1",
        firstAuthorizedAt: "2026-10-18T00:00:00Z",
        lastSeenAt: null,
        isCurrentDevice: null,
      },
    ],
  })
}
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter([{ path: "/devices", element: <DevicesSection /> }], {
    initialEntries: ["/devices?userId=1", "/devices?userId=2"],
    initialIndex: 1,
  })
  return {
    client,
    router,
    ...render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    ),
  }
}
async function choose(account: "A" | "B") {
  const button = await screen.findByRole("button", { name: `撤销 ${account}私有名` })
  await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false))
  fireEvent.click(button)
  fireEvent.change(screen.getByLabelText("操作原因"), { target: { value: `${account}明确选择` } })
}
async function back(router: ReturnType<typeof createMemoryRouter>) {
  await act(async () => {
    await router.navigate(-1)
  })
}
const writes = () => mocks.fetch.mock.calls.filter(([, init]) => init?.method === "POST")
beforeEach(() => {
  mocks.fetch
    .mockReset()
    .mockImplementation(async (url, init) =>
      init?.method === "POST" ? new Response(null, { status: 204 }) : normal(url),
    )
})
afterEach(cleanup)
it("closes B selection on Back to A even when D and both CAS versions are equal, then permits an explicit new A selection", async () => {
  const { router } = mount()
  await choose("B")
  await back(router)
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  expect((screen.getByLabelText("设备用户筛选") as HTMLInputElement).value).toBe("1")
  expect(writes()).toHaveLength(0)
  await choose("A")
  fireEvent.click(screen.getByRole("button", { name: "确认撤销" }))
  await waitFor(() => expect(writes()).toHaveLength(1))
  expect(writes()[0][0]).toBe(`/admin/v1/users/1/devices/${id}/revoke`)
  expect(JSON.parse(String(writes()[0][1]?.body))).toEqual({
    csrf: "server-csrf",
    expectedAuthVersion: "1",
    expectedBindingEpoch: "1",
    reason: "A明确选择",
  })
})
it("does not continue a B bootstrap after Back and does not clear a fresh A pending operation", async () => {
  const bootstraps: ((value: Response) => void)[] = []
  mocks.fetch.mockImplementation(async (url, init) =>
    String(url) === "/admin/v1/session"
      ? new Promise<Response>((resolve) => {
          bootstraps.push(resolve)
        })
      : init?.method === "POST"
        ? new Response(null, { status: 204 })
        : normal(url),
  )
  const { router } = mount()
  await choose("B")
  fireEvent.click(screen.getByRole("button", { name: "确认撤销" }))
  await waitFor(() => expect(bootstraps).toHaveLength(1))
  await back(router)
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  await choose("A")
  fireEvent.click(screen.getByRole("button", { name: "确认撤销" }))
  await waitFor(() => expect(bootstraps).toHaveLength(2))
  await act(async () => {
    bootstraps[0](json({ csrf: "old-B" }))
  })
  expect(writes()).toHaveLength(0)
  expect(screen.getByRole("button", { name: "提交中…" }).hasAttribute("disabled")).toBe(true)
  bootstraps[1](json({ csrf: "new-A" }))
  await waitFor(() => expect(writes()).toHaveLength(1))
  expect(writes()[0][0]).toBe(`/admin/v1/users/1/devices/${id}/revoke`)
})
it.each(["error", "notice"])(
  "does not carry B %s or filter input into the A history entry",
  async (outcome) => {
    mocks.fetch.mockImplementation(async (url, init) =>
      init?.method === "POST"
        ? outcome === "error"
          ? json({ error: "access_denied" }, 403)
          : new Response(null, { status: 204 })
        : normal(url),
    )
    const { router } = mount()
    await choose("B")
    fireEvent.click(screen.getByRole("button", { name: "确认撤销" }))
    if (outcome === "error") await screen.findByRole("alert")
    else await screen.findByText("指定设备关系已撤销，该账号的其他设备保持原状。")
    await back(router)
    await screen.findByText("A私有名")
    expect((screen.getByLabelText("设备用户筛选") as HTMLInputElement).value).toBe("1")
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(screen.queryByRole("alert")).toBeNull()
    expect(screen.queryByText("指定设备关系已撤销，该账号的其他设备保持原状。")).toBeNull()
    expect(writes()).toHaveLength(1)
    expect(writes()[0][0]).toBe(`/admin/v1/users/2/devices/${id}/revoke`)
  },
)
