// 负责真实支付设置 facade、局部秘密、版本冲突及分区权限的交互验证。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { createMemoryRouter, RouterProvider } from "react-router"
import { beforeEach, expect, it, vi } from "vitest"
import SettingsSecurityPage from "@/pages/settings-security"
const mocks = vi.hoisted(() => ({ fetch: vi.fn<typeof fetch>() }))
vi.mock("@/lib/api", async () => {
  const { createClient } = await import("@pigclaude/api/client")
  const { createAdminApi } = await import("@pigclaude/api/admin")
  return { adminApi: createAdminApi(createClient({ fetch: mocks.fetch })) }
})
const view = {
  revision: "7",
  enabled: true,
  gatewayUrl: "https://pay.test",
  pid: "merchant",
  keyConfigured: true,
  payTypes: ["alipay"],
  notifyBaseUrl: "https://home.test",
}
let permissions: string[], conflict: boolean
const writes: Record<string, unknown>[] = []
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(["admin-me"], { id: "ops", status: "active", permissions })
  const router = createMemoryRouter(
    [
      { path: "/settings", element: <SettingsSecurityPage /> },
      { path: "/users", element: <p>目标页</p> },
    ],
    { initialEntries: ["/settings?panel=payment"] },
  )
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { client, router }
}
beforeEach(() => {
  permissions = ["payment:read", "payment:settings:write"]
  conflict = false
  writes.length = 0
  mocks.fetch.mockReset()
  mocks.fetch.mockImplementation(async (url, init) => {
    const path = String(url)
    if (path.includes("turnstile")) throw Error("security endpoint forbidden")
    if (path.endsWith("/session")) return Response.json({ csrf: "csrf" })
    if (path.endsWith("/me")) return Response.json({ id: "ops", status: "active", permissions })
    if (init?.method === "PUT") {
      writes.push(JSON.parse(String(init.body)) as Record<string, unknown>)
      return conflict
        ? Response.json({ code: "SETTINGS_REVISION_CONFLICT" }, { status: 409 })
        : Response.json({ ...view, revision: "8" })
    }
    if (path.includes("audits"))
      return Response.json({
        items: [
          {
            revision: "7",
            actor: "ops",
            type: "save",
            time: "2026-10-23T00:00:00Z",
            changedFields: ["key", "pid"],
          },
        ],
        nextCursor: null,
      })
    return Response.json(view)
  })
})
it("never renders key value and never caches entered key", async () => {
  const { client } = mount()
  const input = await screen.findByLabelText("密钥")
  expect((input as HTMLInputElement).value).toBe("")
  expect((input as HTMLInputElement).placeholder).toBe("已配置，留空则不修改")
  fireEvent.change(input, { target: { value: "local-secret" } })
  fireEvent.click(screen.getByRole("button", { name: "保存配置" }))
  await waitFor(() => expect(writes).toHaveLength(1))
  expect(writes[0]).toMatchObject({ key: "local-secret", expectedRevision: "7" })
  await waitFor(() => expect((screen.getByLabelText("密钥") as HTMLInputElement).value).toBe(""))
  expect(
    JSON.stringify(
      client
        .getQueryCache()
        .getAll()
        .map((q) => q.state),
    ),
  ).not.toContain("local-secret")
  expect(client.getMutationCache().getAll()).toHaveLength(0)
  expect(screen.getByText(/key、pid/)).toBeTruthy()
  expect(mocks.fetch.mock.calls.some(([url]) => String(url).includes("turnstile"))).toBe(false)
})
it("blank key is omitted on save", async () => {
  mount()
  fireEvent.change(await screen.findByLabelText("PID"), { target: { value: "new" } })
  fireEvent.click(screen.getByRole("button", { name: "保存配置" }))
  await waitFor(() => expect(writes).toHaveLength(1))
  expect(writes[0]).not.toHaveProperty("key")
})
it("revision conflict message", async () => {
  conflict = true
  mount()
  fireEvent.change(await screen.findByLabelText("PID"), { target: { value: "new" } })
  fireEvent.click(screen.getByRole("button", { name: "保存配置" }))
  await screen.findByText("配置已被他人修改，请刷新")
})
it("payment-only read is reachable and cannot edit", async () => {
  permissions = ["payment:read"]
  mount()
  expect(((await screen.findByLabelText("PID")) as HTMLInputElement).disabled).toBe(true)
  expect(screen.queryByRole("button", { name: "安全风控" })).toBeNull()
  expect(writes).toHaveLength(0)
})
it("dirty navigation is blocked", async () => {
  const { router } = mount()
  fireEvent.change(await screen.findByLabelText("PID"), { target: { value: "new" } })
  await act(() => router.navigate("/users"))
  await screen.findByText("放弃未保存的修改？")
  fireEvent.click(screen.getByRole("button", { name: "放弃修改并离开" }))
  await screen.findByText("目标页")
})
it("dirty section switch asks before discarding local key", async () => {
  permissions.push("settings:read")
  const { router } = mount()
  fireEvent.change(await screen.findByLabelText("密钥"), { target: { value: "discard-me" } })
  fireEvent.click(screen.getByRole("button", { name: "安全风控" }))
  await screen.findByText("放弃未保存的修改？")
  expect(router.state.location.search).toBe("?panel=payment")
  fireEvent.click(screen.getByRole("button", { name: "继续编辑" }))
  expect((screen.getByLabelText("密钥") as HTMLInputElement).value).toBe("discard-me")
  fireEvent.click(screen.getByRole("button", { name: "安全风控" }))
  fireEvent.click(await screen.findByRole("button", { name: "放弃修改并离开" }))
  await screen.findByText("设置加载失败")
  fireEvent.click(screen.getByRole("button", { name: "易支付" }))
  expect(((await screen.findByLabelText("密钥")) as HTMLInputElement).value).toBe("")
})
it("failed initial payment load offers retry without editable empty defaults", async () => {
  mocks.fetch.mockResolvedValue(Response.json({ code: "SETTINGS_UNAVAILABLE" }, { status: 503 }))
  mount()
  await screen.findByText("设置加载失败")
  expect(screen.queryByLabelText("PID")).toBeNull()
  expect(screen.queryByRole("button", { name: "保存配置" })).toBeNull()
})
