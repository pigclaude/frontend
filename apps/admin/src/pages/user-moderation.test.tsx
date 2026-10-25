// 负责验证后台账号状态筛选、精确权限、CAS、原样理由和真实写入归属。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import UsersPage from "./users"
const mocks = vi.hoisted(() => ({
  fetch: vi.fn<typeof fetch>(),
  permissions: ["users:read", "users:ban", "users:unban", "users:sessions:revoke"],
}))
vi.mock("@/lib/api", async () => {
  const { createClient } = await import("@pigclaude/api/client")
  const { createAdminApi } = await import("@pigclaude/api/admin")
  return { adminApi: createAdminApi(createClient({ fetch: mocks.fetch })) }
})
const version = "9007199254740993"
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
          <UsersPage />
        </QueryClientProvider>
      </MemoryRouter>,
    ),
  }
}
beforeEach(() => {
  mocks.permissions = ["users:read", "users:ban", "users:unban", "users:sessions:revoke"]
  mocks.fetch.mockReset().mockImplementation(async (url) => {
    if (String(url) === "/admin/v1/me")
      return json({
        id: "a1",
        account: "operator",
        status: "active",
        permissions: mocks.permissions,
      })
    if (String(url).startsWith("/admin/v1/users?"))
      return json({
        items: [
          {
            id: "42",
            nickname: "目标用户",
            email: "masked@example.test",
            status: "active",
            authVersion: version,
            createdAt: "2026-10-18T00:00:00Z",
            lastLoginAt: null,
            avatar: "",
            githubLogin: "",
          },
        ],
        nextCursor: "0",
      })
    if (String(url) === "/admin/v1/session") return json({ csrf: "admin-csrf" })
    return json({ userId: "42", status: "banned", authVersion: "9007199254740994" })
  })
})
afterEach(cleanup)
describe("账号治理", () => {
  it("submits the status filter to the actual users query", async () => {
    mount()
    await screen.findByText("目标用户")
    fireEvent.change(screen.getByLabelText("账号状态"), { target: { value: "banned" } })
    await waitFor(() =>
      expect(mocks.fetch.mock.calls.some(([url]) => String(url).includes("status=banned"))).toBe(
        true,
      ),
    )
  })
  it("sends reason unchanged and version as string only after confirmation", async () => {
    const view = mount()
    fireEvent.click(await screen.findByRole("button", { name: "详情" }))
    fireEvent.click(await screen.findByRole("button", { name: "封禁账号" }))
    fireEvent.change(screen.getByLabelText("操作原因"), { target: { value: "  现场核实  " } })
    fireEvent.click(screen.getByRole("button", { name: "确认封禁" }))
    await waitFor(() =>
      expect(mocks.fetch.mock.calls.some(([url]) => String(url).endsWith("/42/ban"))).toBe(true),
    )
    const call = mocks.fetch.mock.calls.find(([url]) => String(url).endsWith("/42/ban"))!
    expect(JSON.parse(String(call[1]?.body))).toEqual({
      csrf: "admin-csrf",
      expectedAuthVersion: version,
      reason: "  现场核实  ",
    })
    expect((call[1]?.headers as Record<string, string>)["X-CSRF-Token"]).toBeUndefined()
    await waitFor(() => expect(screen.getByRole("button", { name: "解封账号" })).toBeTruthy())
    expect(view.client.getMutationCache().getAll()).toHaveLength(0)
  })
  it.each([["users:read"], ["users:read", "users:*", "admin:*"], ["users:read", "users:unban"]])(
    "hides unauthorized active-account writes for %j",
    async (...permissions) => {
      mocks.permissions = permissions
      mount()
      fireEvent.click(await screen.findByRole("button", { name: "详情" }))
      expect(screen.queryByRole("button", { name: "封禁账号" })).toBeNull()
      expect(screen.queryByRole("button", { name: "强制下线" })).toBeNull()
    },
  )
  it("does not announce successful ban on backend permission denial", async () => {
    const original = mocks.fetch.getMockImplementation()!
    mocks.fetch.mockImplementation(async (url, init) =>
      String(url).endsWith("/ban")
        ? json({ error: "access_denied", message: "raw internal reason" }, 403)
        : original(url, init),
    )
    mount()
    fireEvent.click(await screen.findByRole("button", { name: "详情" }))
    fireEvent.click(await screen.findByRole("button", { name: "封禁账号" }))
    fireEvent.change(screen.getByLabelText("操作原因"), { target: { value: "reason" } })
    fireEvent.click(screen.getByRole("button", { name: "确认封禁" }))
    expect((await screen.findByRole("alert")).textContent).toContain("权限")
    expect(screen.queryByRole("button", { name: "解封账号" })).toBeNull()
    expect(screen.queryByText("raw internal reason")).toBeNull()
  })
  it("does not issue business HTTP after drawer unmount during bootstrap", async () => {
    let complete: (value: Response) => void = () => {}
    const original = mocks.fetch.getMockImplementation()!
    mocks.fetch.mockImplementation(async (url, init) =>
      String(url) === "/admin/v1/session"
        ? new Promise<Response>((resolve) => {
            complete = resolve
          })
        : original(url, init),
    )
    const view = mount()
    fireEvent.click(await screen.findByRole("button", { name: "详情" }))
    fireEvent.click(await screen.findByRole("button", { name: "封禁账号" }))
    fireEvent.change(screen.getByLabelText("操作原因"), { target: { value: "reason" } })
    fireEvent.click(screen.getByRole("button", { name: "确认封禁" }))
    await waitFor(() =>
      expect(mocks.fetch.mock.calls.some(([url]) => String(url) === "/admin/v1/session")).toBe(
        true,
      ),
    )
    view.unmount()
    complete(json({ csrf: "old-csrf" }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mocks.fetch.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false)
  })
})

it.each(["unban", "sessions/revoke"])(
  "uses the authoritative response and unchanged reason for %s",
  async (path) => {
    let state = "banned"
    let version = "9007199254740993"
    const original = mocks.fetch.getMockImplementation()!
    mocks.fetch.mockImplementation(async (url, init) => {
      if (String(url).startsWith("/admin/v1/users?")) {
        const response = await original(url, init)
        const data = await response.json()
        data.items[0].status = state
        data.items[0].authVersion = version
        return json(data)
      }
      if (String(url).endsWith(`/${path}`)) {
        state = path === "unban" ? "active" : "banned"
        version = "9007199254740994"
        return json({ userId: "42", status: state, authVersion: version })
      }
      return original(url, init)
    })
    mount()
    fireEvent.click(await screen.findByRole("button", { name: "详情" }))
    fireEvent.click(
      await screen.findByRole("button", { name: path === "unban" ? "解封账号" : "强制下线" }),
    )
    if (path === "unban") expect(screen.getByText(/解封不会恢复旧登录/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText("操作原因"), { target: { value: " 原因原样 " } })
    fireEvent.click(
      screen.getByRole("button", { name: path === "unban" ? "确认解封" : "确认强制下线" }),
    )
    expect((await screen.findByRole("status")).textContent).toContain("需要重新认证")
    const call = mocks.fetch.mock.calls.find(([url]) => String(url).endsWith(`/${path}`))!
    expect(JSON.parse(String(call[1]?.body))).toEqual({
      csrf: "admin-csrf",
      expectedAuthVersion: "9007199254740993",
      reason: " 原因原样 ",
    })
  },
)
it("rereads a conflicting account and does not replay the previous action", async () => {
  let conflicted = false
  const original = mocks.fetch.getMockImplementation()!
  mocks.fetch.mockImplementation(async (url, init) => {
    if (String(url).endsWith("/ban")) {
      conflicted = true
      return json({ error: "account_conflict" }, 409)
    }
    if (String(url).startsWith("/admin/v1/users?")) {
      const response = await original(url, init)
      const body = await response.json()
      if (conflicted) {
        body.items[0].status = "banned"
        body.items[0].authVersion = "9007199254740994"
      }
      return json(body)
    }
    return original(url, init)
  })
  mount()
  fireEvent.click(await screen.findByRole("button", { name: "详情" }))
  fireEvent.click(await screen.findByRole("button", { name: "封禁账号" }))
  fireEvent.change(screen.getByLabelText("操作原因"), { target: { value: "reason" } })
  fireEvent.click(screen.getByRole("button", { name: "确认封禁" }))
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  expect((await screen.findByRole("alert")).textContent).toContain("已变化")
  await waitFor(() => expect(screen.getByRole("table").textContent).toContain("已封禁"))
  expect(mocks.fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1)
})

it.each(["success", "failure"])(
  "does not update shared caches from a late %s moderation response",
  async (outcome) => {
    let complete: (value: Response) => void = () => {}
    const original = mocks.fetch.getMockImplementation()!
    mocks.fetch.mockImplementation(async (url, init) =>
      String(url).endsWith("/ban")
        ? new Promise<Response>((resolve) => {
            complete = resolve
          })
        : original(url, init),
    )
    const view = mount()
    const invalidate = vi.spyOn(view.client, "invalidateQueries")
    fireEvent.click(await screen.findByRole("button", { name: "详情" }))
    fireEvent.click(await screen.findByRole("button", { name: "封禁账号" }))
    fireEvent.change(screen.getByLabelText("操作原因"), { target: { value: "reason" } })
    fireEvent.click(screen.getByRole("button", { name: "确认封禁" }))
    await waitFor(() =>
      expect(mocks.fetch.mock.calls.some(([url]) => String(url).endsWith("/ban"))).toBe(true),
    )
    view.unmount()
    view.client.setQueryData(["new-session"], { id: "next" })
    complete(
      outcome === "success"
        ? json({ userId: "42", status: "banned", authVersion: "2" })
        : json({ error: "access_denied" }, 403),
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(invalidate).not.toHaveBeenCalled()
    expect(view.client.getQueryData(["new-session"])).toEqual({ id: "next" })
  },
)
it("does not load user profiles for a device-only administrator", async () => {
  mocks.permissions = ["device:read", "device:revoke"]
  mount()
  expect((await screen.findByRole("alert")).textContent).toContain("权限")
  expect(mocks.fetch.mock.calls.some(([url]) => String(url).startsWith("/admin/v1/users?"))).toBe(
    false,
  )
})

it("keeps the new moderation pending when a previous consumer fails late", async () => {
  const completions: ((value: Response) => void)[] = []
  const original = mocks.fetch.getMockImplementation()!
  mocks.fetch.mockImplementation(async (url, init) =>
    String(url).endsWith("/ban")
      ? new Promise<Response>((resolve) => {
          completions.push(resolve)
        })
      : original(url, init),
  )
  async function start() {
    fireEvent.click(await screen.findByRole("button", { name: "详情" }))
    fireEvent.click(await screen.findByRole("button", { name: "封禁账号" }))
    fireEvent.change(screen.getByLabelText("操作原因"), { target: { value: "reason" } })
    fireEvent.click(screen.getByRole("button", { name: "确认封禁" }))
  }
  const old = mount()
  await start()
  await waitFor(() => expect(completions).toHaveLength(1))
  old.unmount()
  mount()
  await start()
  await waitFor(() => expect(completions).toHaveLength(2))
  completions[0](json({ error: "access_denied" }, 403))
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(screen.getByRole("button", { name: "提交中…" }).hasAttribute("disabled")).toBe(true)
  expect(screen.queryByRole("alert")).toBeNull()
  completions[1](json({ error: "access_denied" }, 403))
  expect((await screen.findByRole("alert")).textContent).toContain("权限")
})

it("closes an open moderation confirmation when live write permission is removed", async () => {
  const view = mount()
  fireEvent.click(await screen.findByRole("button", { name: "详情" }))
  fireEvent.click(await screen.findByRole("button", { name: "封禁账号" }))
  expect(screen.getByRole("dialog", { name: "封禁账号" })).toBeTruthy()
  view.client.setQueryData(["admin-me"], {
    id: "a1",
    account: "operator",
    status: "active",
    permissions: ["users:read"],
  })
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "封禁账号" })).toBeNull())
  expect(screen.queryByRole("button", { name: "封禁账号" })).toBeNull()
  expect(mocks.fetch.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false)
})
