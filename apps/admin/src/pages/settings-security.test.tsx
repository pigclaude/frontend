// 负责通过真实页面、查询缓存和 HTTP facade 验证安全设置的保存与权限边界。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { createMemoryRouter, RouterProvider } from "react-router"
import { beforeEach, expect, it, vi } from "vitest"
import type { TurnstileOptions } from "@pigclaude/web-ui/lib/turnstile-sdk"
import SettingsSecurityPage from "./settings-security"
const mocks = vi.hoisted(() => ({ fetch: vi.fn<typeof fetch>() }))
vi.mock("@/lib/api", async () => {
  const { createClient } = await import("@pigclaude/api/client")
  const { createAdminApi } = await import("@pigclaude/api/admin")
  return { adminApi: createAdminApi(createClient({ fetch: mocks.fetch })) }
})
const summary = {
  revision: "2",
  enabled: true,
  mode: "required",
  siteKey: "saved-site",
  hostnames: ["admin.local"],
  secretConfigured: true,
  updatedAt: "2026-10-18T00:00:00Z",
  updatedBy: "admin",
}
let candidate = false
const widgets: TurnstileOptions[] = []
let failLoad = false
let failSave = false
let failActivation = false
const writes: unknown[] = []
function mount(permissions = ["settings:read", "settings:write"]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(["admin-me"], { id: "1", account: "ops", status: "active", permissions })
  const router = createMemoryRouter(
    [
      { path: "/settings", element: <SettingsSecurityPage /> },
      { path: "/users", element: <p>用户目标页</p> },
    ],
    { initialEntries: ["/settings"] },
  )
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { client, router }
}
beforeEach(() => {
  widgets.length = 0
  candidate = false
  Object.assign(window, {
    turnstile: {
      render: (_container: HTMLElement, options: TurnstileOptions) => {
        widgets.push(options)
        return String(widgets.length)
      },
      remove: () => {},
    },
  })
  failLoad = false
  failSave = false
  failActivation = false
  writes.length = 0
  mocks.fetch.mockReset()
  mocks.fetch.mockImplementation(async (url, init) => {
    if (String(url) === "/admin/v1/session")
      return new Response(JSON.stringify({ csrf: "settings-csrf" }))
    if (init?.method === "PUT" || init?.method === "POST")
      expect(new Headers(init.headers).get("X-CSRF-Token")).toBe("settings-csrf")
    const path = String(url)
    let body: unknown = path.endsWith("/me")
      ? {
          id: "1",
          account: "ops",
          status: "active",
          permissions: ["settings:read", "settings:write"],
        }
      : path.includes("audits")
        ? { items: [], nextCursor: null }
        : {
            revision: "2",
            active: summary,
            draft: candidate ? { ...summary, siteKey: "candidate-site" } : null,
          }
    let status = 200
    if (init?.method === "PUT") {
      writes.push(JSON.parse(String(init.body)) as unknown)
      if (failSave) {
        body = { code: "SETTINGS_UNAVAILABLE", message: "保存失败" }
        status = 503
      } else body = { revision: "3", active: summary, draft: { ...summary, revision: "3" } }
    } else if (init?.method === "POST" && path.endsWith("/activate") && failActivation) {
      body = { code: "CAPTCHA_INVALID", message: "草稿验证失败" }
      status = 400
    } else if (failLoad && path.includes("settings")) {
      body = { message: "加载失败" }
      status = 503
    }
    return new Response(JSON.stringify(body), { status })
  })
})
it("saved_secret_is_never_prefilled_or_cached", async () => {
  const { client } = mount()
  const input = await screen.findByLabelText("Secret Key")
  expect((input as HTMLInputElement).value).toBe("")
  fireEvent.change(input, { target: { value: "new-private-material" } })
  fireEvent.click(screen.getByRole("button", { name: "保存草稿" }))
  await waitFor(() => expect(writes).toHaveLength(1))
  await waitFor(() =>
    expect((screen.getByLabelText("Secret Key") as HTMLInputElement).value).toBe(""),
  )
  expect(mocks.fetch.mock.calls.filter(([url]) => String(url).endsWith("/activate"))).toHaveLength(
    0,
  )
  expect(writes[0]).toMatchObject({ secretKey: "new-private-material", expectedRevision: "2" })
  expect(
    JSON.stringify(
      client
        .getQueryCache()
        .getAll()
        .map((item) => item.state),
    ),
  ).not.toContain("new-private-material")
  expect(JSON.stringify(client.getMutationCache().getAll())).not.toContain("new-private-material")
})
it("failed_load_cannot_save_empty_defaults", async () => {
  failLoad = true
  mount()
  await screen.findByText("设置加载失败")
  expect(screen.queryByLabelText("Site Key")).toBeNull()
  expect(screen.queryByRole("button", { name: "保存草稿" })).toBeNull()
})
it("failed save retains form for retry without cached secrets", async () => {
  failSave = true
  const { client } = mount()
  fireEvent.change(await screen.findByLabelText("Secret Key"), {
    target: { value: "retry-secret" },
  })
  fireEvent.click(screen.getByRole("button", { name: "保存草稿" }))
  await screen.findByText("安全设置暂时不可用，请稍后刷新，或联系管理员检查服务配置")
  expect((screen.getByLabelText("Secret Key") as HTMLInputElement).value).toBe("retry-secret")
  expect(JSON.stringify(client.getMutationCache().getAll())).not.toContain("retry-secret")
  failSave = false
  failActivation = false
  fireEvent.click(screen.getByRole("button", { name: "保存草稿" }))
  await waitFor(() => expect(writes).toHaveLength(2))
})
it("dirty_form_requires_discard_confirmation", async () => {
  const { router } = mount()
  fireEvent.change(await screen.findByLabelText("Secret Key"), {
    target: { value: "discard-secret" },
  })
  void router.navigate("/users?cursor=a%2Bb")
  await screen.findByRole("dialog")
  expect(screen.queryByText("用户目标页")).toBeNull()
  fireEvent.click(screen.getByRole("button", { name: "继续编辑" }))
  expect((screen.getByLabelText("Secret Key") as HTMLInputElement).value).toBe("discard-secret")
  void router.navigate("/users?cursor=a%2Bb")
  fireEvent.click(await screen.findByRole("button", { name: "放弃修改并离开" }))
  await screen.findByText("用户目标页")
  expect(router.state.location.search).toBe("?cursor=a%2Bb")
})
it("readonly_admin_cannot_write", async () => {
  mount(["settings:read"])
  expect(((await screen.findByLabelText("Site Key")) as HTMLInputElement).disabled).toBe(true)
  expect((screen.getByRole("button", { name: "保存草稿" }) as HTMLButtonElement).disabled).toBe(
    true,
  )
})
it("denies page without settings read permission", async () => {
  mount(["membership:write"])
  await screen.findByText("无权查看系统设置")
  expect(screen.queryByLabelText("Secret Key")).toBeNull()
})

it("uses candidate site key and admin action proof, never activates on save", async () => {
  candidate = true
  mount()
  await waitFor(() => expect(widgets).toHaveLength(1))
  expect(widgets[0].sitekey).toBe("candidate-site")
  expect(widgets[0].action).toBe("admin_login")
  const activate = screen.getByRole("button", { name: "验证并启用" }) as HTMLButtonElement
  expect(activate.disabled).toBe(true)
  act(() => widgets[0].callback("candidate-proof"))
  expect(activate.disabled).toBe(false)
  fireEvent.click(activate)
  await waitFor(() =>
    expect(
      mocks.fetch.mock.calls.some(
        ([url, init]) => String(url).endsWith("/activate") && init?.method === "POST",
      ),
    ).toBe(true),
  )
  const request = mocks.fetch.mock.calls.find(([url]) => String(url).endsWith("/activate"))
  expect(JSON.parse(String(request?.[1]?.body))).toEqual({
    expectedRevision: "2",
    captchaToken: "candidate-proof",
  })
  expect(writes).toHaveLength(0)
})
it("requires independent confirmation to disable", async () => {
  mount()
  fireEvent.click(await screen.findByRole("button", { name: "关闭验证" }))
  expect(mocks.fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0)
  fireEvent.click(screen.getByRole("button", { name: "确认关闭" }))
  await waitFor(() =>
    expect(mocks.fetch.mock.calls.some(([url]) => String(url).endsWith("/disable"))).toBe(true),
  )
  const request = mocks.fetch.mock.calls.find(([url]) => String(url).endsWith("/disable"))
  expect(JSON.parse(String(request?.[1]?.body))).toEqual({ expectedRevision: "2", confirmed: true })
})

it("failed activation keeps draft and requires a fresh proof for retry", async () => {
  candidate = true
  failActivation = true
  mount()
  await waitFor(() => expect(widgets).toHaveLength(1))
  act(() => widgets[0].callback("failed-proof"))
  fireEvent.click(screen.getByRole("button", { name: "验证并启用" }))
  await screen.findByText("草稿验证码无效或已过期，请重新验证")
  await waitFor(() => expect(widgets.length).toBeGreaterThan(1))
  expect((screen.getByRole("button", { name: "验证并启用" }) as HTMLButtonElement).disabled).toBe(
    true,
  )
  act(() => widgets[0].callback("stale-failed-proof"))
  expect((screen.getByRole("button", { name: "验证并启用" }) as HTMLButtonElement).disabled).toBe(
    true,
  )
  expect((screen.getByLabelText("Site Key") as HTMLInputElement).value).toBe("candidate-site")
})

it.each([
  [
    "INVALID_INPUT",
    400,
    "设置输入不合法，请检查 Site Key、Secret Key 和允许主机名；管理设置不能使用测试 key",
  ],
  [
    "SETTINGS_REVISION_CONFLICT",
    409,
    "设置已被其他管理员修改，请保留当前输入，撤销修改后刷新配置再重试",
  ],
  ["FORBIDDEN", 403, "没有管理设置的权限，或请求来源不受信任，请从管理后台重新登录后重试"],
  ["SETTINGS_UNAVAILABLE", 503, "安全设置暂时不可用，请稍后刷新，或联系管理员检查服务配置"],
  ["CAPTCHA_UNAVAILABLE", 503, "验证码服务暂时不可用，请稍后重新验证草稿"],
  ["UNKNOWN_CODE", 500, "安全设置操作失败，请稍后重试"],
])("shows safe Chinese write feedback for %s", async (code, status, message) => {
  const normal = mocks.fetch.getMockImplementation()!
  mocks.fetch.mockImplementation(async (url, init) =>
    init?.method === "PUT"
      ? new Response(
          JSON.stringify({
            code,
            message: "SQL private-key-sentinel",
            reason: "raw-internal-detail",
          }),
          { status },
        )
      : normal(url, init),
  )
  mount()
  fireEvent.change(await screen.findByLabelText("Secret Key"), {
    target: { value: "local-form-secret" },
  })
  fireEvent.click(screen.getByRole("button", { name: "保存草稿" }))
  expect((await screen.findByRole("alert")).textContent).toBe(message)
  expect(document.body.textContent).not.toContain("private-key-sentinel")
  expect(document.body.textContent).not.toContain("raw-internal-detail")
  expect((screen.getByLabelText("Secret Key") as HTMLInputElement).value).toBe("local-form-secret")
})
it("explains initial load failure using the stable code", async () => {
  mocks.fetch.mockResolvedValue(
    new Response(
      JSON.stringify({ code: "SETTINGS_UNAVAILABLE", message: "SQL private-key-sentinel" }),
      { status: 503 },
    ),
  )
  mount()
  expect((await screen.findByRole("alert")).textContent).toContain(
    "安全设置暂时不可用，请稍后刷新，或联系管理员检查服务配置",
  )
  expect(screen.queryByLabelText("Site Key")).toBeNull()
  expect(document.body.textContent).not.toContain("private-key-sentinel")
})
it("explains refresh failure while retaining the loaded view", async () => {
  mount()
  await screen.findByLabelText("Site Key")
  mocks.fetch.mockResolvedValue(
    new Response(JSON.stringify({ code: "FORBIDDEN", message: "SQL private-key-sentinel" }), {
      status: 403,
    }),
  )
  fireEvent.click(screen.getByRole("button", { name: "刷新配置" }))
  expect((await screen.findByRole("alert")).textContent).toContain(
    "没有管理设置的权限，或请求来源不受信任",
  )
  expect((screen.getByLabelText("Site Key") as HTMLInputElement).value).toBe("saved-site")
  expect(document.body.textContent).not.toContain("private-key-sentinel")
})
