// 负责邮件设置面板的腾讯默认值、加密端口建议、授权码脱敏、测试发信原因与权限隐藏。
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
const emptyView = {
  revision: "0",
  enabled: false,
  host: "",
  port: 0,
  encryption: "ssl",
  username: "",
  passwordConfigured: false,
  fromName: "",
  fromAddress: "",
}
const savedView = {
  revision: "4",
  enabled: true,
  host: "smtp.example.com",
  port: 465,
  encryption: "ssl",
  username: "mailer@example.com",
  passwordConfigured: true,
  fromName: "PigClaude",
  fromAddress: "mailer@example.com",
}
let view: Record<string, unknown>
let permissions: string[]
let conflict: boolean
let testReason: string | null
const writes: Record<string, unknown>[] = []
const tests: Record<string, unknown>[] = []
function mount(panel = "mail") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(["admin-me"], { id: "ops", status: "active", permissions })
  const router = createMemoryRouter(
    [
      { path: "/settings", element: <SettingsSecurityPage /> },
      { path: "/users", element: <p>目标页</p> },
    ],
    { initialEntries: [`/settings?panel=${panel}`] },
  )
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { client, router }
}
beforeEach(() => {
  view = { ...emptyView }
  permissions = ["settings:read", "settings:write"]
  conflict = false
  testReason = null
  writes.length = 0
  tests.length = 0
  mocks.fetch.mockReset()
  mocks.fetch.mockImplementation(async (url, init) => {
    const path = String(url)
    if (path.endsWith("/session")) return Response.json({ csrf: "csrf" })
    if (path.endsWith("/me")) return Response.json({ id: "ops", status: "active", permissions })
    if (path.endsWith("/settings/mail/test")) {
      tests.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return testReason
        ? Response.json(
            { code: "MAIL_TEST_FAILED", metadata: { reason: testReason } },
            { status: 502 },
          )
        : Response.json({ type: "sent" })
    }
    if (init?.method === "PUT") {
      writes.push(JSON.parse(String(init.body)) as Record<string, unknown>)
      return conflict
        ? Response.json({ code: "SETTINGS_REVISION_CONFLICT" }, { status: 409 })
        : Response.json({ ...view, revision: String(Number(view.revision) + 1) })
    }
    if (path.includes("audits"))
      return Response.json({
        items: [
          {
            revision: "4",
            actor: "ops",
            type: "save",
            time: "2026-10-23T00:00:00Z",
            changedFields: ["host", "port"],
          },
        ],
        nextCursor: null,
      })
    return Response.json(view)
  })
})
it("prefills Tencent defaults for a new configuration", async () => {
  mount()
  expect(((await screen.findByLabelText("SMTP 主机")) as HTMLInputElement).value).toBe(
    "smtp.exmail.qq.com",
  )
  expect((screen.getByLabelText("端口") as HTMLInputElement).value).toBe("465")
  expect(screen.getByRole("radio", { name: "SSL" }).getAttribute("aria-checked")).toBe("true")
  expect(screen.getByRole("radio", { name: "STARTTLS" }).getAttribute("aria-checked")).toBe("false")
})
it("switching encryption to STARTTLS suggests port 587 unless the port was edited", async () => {
  mount()
  const port = (await screen.findByLabelText("端口")) as HTMLInputElement
  fireEvent.click(screen.getByRole("radio", { name: "STARTTLS" }))
  expect(port.value).toBe("587")
  fireEvent.click(screen.getByRole("radio", { name: "SSL" }))
  expect(port.value).toBe("465")
  fireEvent.change(port, { target: { value: "2525" } })
  fireEvent.click(screen.getByRole("radio", { name: "STARTTLS" }))
  expect(port.value).toBe("2525")
  fireEvent.click(screen.getByRole("radio", { name: "SSL" }))
  expect(port.value).toBe("2525")
})
it("shows 已设置 for a configured password and never renders its value", async () => {
  view = { ...savedView }
  mount()
  await screen.findByLabelText("SMTP 主机")
  expect(screen.getByText("已设置")).toBeTruthy()
  const password = screen.getByLabelText("授权码") as HTMLInputElement
  expect(password.type).toBe("password")
  expect(password.value).toBe("")
  fireEvent.change(screen.getByLabelText("发件人名称"), { target: { value: "New Name" } })
  fireEvent.click(screen.getByRole("button", { name: "保存" }))
  await waitFor(() => expect(writes).toHaveLength(1))
  expect(writes[0]).not.toHaveProperty("password")
  expect(JSON.stringify(writes[0])).not.toContain("smtp-authorization-code")
})
it("keeps an entered authorization code out of saved views", async () => {
  view = { ...savedView }
  const { client } = mount()
  const password = (await screen.findByLabelText("授权码")) as HTMLInputElement
  fireEvent.change(password, { target: { value: "local-authorization-code" } })
  fireEvent.click(screen.getByRole("button", { name: "保存" }))
  await waitFor(() => expect(writes).toHaveLength(1))
  expect(writes[0]).toMatchObject({
    expectedRevision: "4",
    password: "local-authorization-code",
  })
  expect(
    JSON.stringify(
      client
        .getQueryCache()
        .getAll()
        .map((item) => item.state),
    ),
  ).not.toContain("local-authorization-code")
  expect(JSON.stringify(client.getMutationCache().getAll())).not.toContain(
    "local-authorization-code",
  )
})
it.each([
  ["auth", "认证失败：检查邮箱地址和授权码"],
  ["connect", "连接失败：检查主机和端口"],
  ["rejected", "对方拒收"],
  ["timeout", "连接超时"],
  ["not_configured", "请先保存并启用"],
])("test send shows the mapped %s reason", async (reason, message) => {
  view = { ...savedView }
  testReason = reason
  mount()
  fireEvent.click(await screen.findByRole("button", { name: "发送测试邮件" }))
  fireEvent.change(screen.getByLabelText("收件地址"), { target: { value: "ops@example.com" } })
  fireEvent.click(screen.getByRole("button", { name: "发送" }))
  expect(await screen.findByText(message)).toBeTruthy()
  expect(tests).toEqual([{ to: "ops@example.com" }])
})
it("test send reports success after a recipient is entered", async () => {
  view = { ...savedView }
  mount()
  fireEvent.click(await screen.findByRole("button", { name: "发送测试邮件" }))
  fireEvent.change(screen.getByLabelText("收件地址"), { target: { value: "ops@example.com" } })
  fireEvent.click(screen.getByRole("button", { name: "发送" }))
  expect(await screen.findByText("测试邮件已发送")).toBeTruthy()
  expect(tests).toEqual([{ to: "ops@example.com" }])
})
it("mirrors the sending account into the default from address until edited", async () => {
  mount()
  const username = (await screen.findByLabelText("发信邮箱")) as HTMLInputElement
  const fromAddress = screen.getByLabelText("发件地址") as HTMLInputElement
  fireEvent.change(username, { target: { value: "mailer@example.com" } })
  expect(fromAddress.value).toBe("mailer@example.com")
  fireEvent.change(fromAddress, { target: { value: "sender@example.com" } })
  fireEvent.change(username, { target: { value: "other@example.com" } })
  expect(fromAddress.value).toBe("sender@example.com")
})
it("read-only mail settings cannot edit or send", async () => {
  view = { ...savedView }
  permissions = ["settings:read"]
  mount()
  expect(((await screen.findByLabelText("SMTP 主机")) as HTMLInputElement).disabled).toBe(true)
  expect((screen.getByRole("button", { name: "发送测试邮件" }) as HTMLButtonElement).disabled).toBe(
    true,
  )
  expect(screen.getByText("只读权限，可查看配置与历史。")).toBeTruthy()
})
it.each([[[]], [["settings:write"]]] as const)(
  "hides the mail panel without settings:read (%j)",
  async (allowed) => {
    permissions = [...allowed]
    mount()
    await screen.findByText("无权查看系统设置")
    expect(screen.queryByRole("button", { name: "邮件" })).toBeNull()
    expect(mocks.fetch.mock.calls.some(([url]) => String(url).includes("/settings/mail"))).toBe(
      false,
    )
  },
)
it("revision conflict message", async () => {
  view = { ...savedView }
  conflict = true
  mount()
  fireEvent.change(await screen.findByLabelText("SMTP 主机"), {
    target: { value: "smtp.next.example.com" },
  })
  fireEvent.click(screen.getByRole("button", { name: "保存" }))
  await screen.findByText("配置已被他人修改，请刷新")
})
it("dirty navigation is blocked", async () => {
  view = { ...savedView }
  const { router } = mount()
  fireEvent.change(await screen.findByLabelText("SMTP 主机"), {
    target: { value: "smtp.next.example.com" },
  })
  await act(() => router.navigate("/users"))
  await screen.findByText("放弃未保存的修改？")
  fireEvent.click(screen.getByRole("button", { name: "放弃修改并离开" }))
  await screen.findByText("目标页")
})
it("shows mail audit history", async () => {
  view = { ...savedView }
  mount()
  expect(await screen.findByText(/host、port/)).toBeTruthy()
})
