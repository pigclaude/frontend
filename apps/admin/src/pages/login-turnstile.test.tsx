// 负责用真实管理员表单与 HTTP facade 验证验证码 token、失败重置和成功导航。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter, useLocation } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { TurnstileOptions } from "@pigclaude/web-ui/lib/turnstile-sdk"
import LoginPage from "./login"
import { adminApi } from "@/lib/api"

const mocks = vi.hoisted(() => ({ fetch: vi.fn<typeof fetch>(), toast: vi.fn() }))
vi.mock("sonner", () => ({ toast: { error: mocks.toast, success: vi.fn() } }))
vi.mock("@/lib/api", async () => {
  const { createClient } = await import("@pigclaude/api/client")
  const { createAdminApi } = await import("@pigclaude/api/admin")
  return { adminApi: createAdminApi(createClient({ fetch: mocks.fetch })) }
})

const widgets: { options: TurnstileOptions; removed: boolean }[] = []
let failure = true
function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status })
}
function LocationProbe() {
  const location = useLocation()
  return <output aria-label="当前路径">{location.pathname + location.search}</output>
}
function mount(redirect = "/users") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryDefaults(["admin-me"], { queryFn: adminApi.me })
  client.setQueryData(["admin-me"], { account: "old" })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/login?redirect=${encodeURIComponent(redirect)}`]}>
        <LoginPage />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  fireEvent.change(screen.getByLabelText("账号"), { target: { value: " admin_ops " } })
  fireEvent.change(screen.getByLabelText("密码"), { target: { value: "password" } })
  return client
}
function submit() {
  fireEvent.submit(document.querySelector("form") as HTMLFormElement)
}
function posts() {
  return mocks.fetch.mock.calls.filter(([, init]) => init?.method === "POST")
}

beforeEach(() => {
  vi.clearAllMocks()
  widgets.length = 0
  failure = true
  Object.assign(window, {
    turnstile: {
      render: (_container: HTMLElement, options: TurnstileOptions) => {
        widgets.push({ options, removed: false })
        return String(widgets.length - 1)
      },
      remove: (id: string) => {
        widgets[Number(id)].removed = true
      },
    },
  })
  mocks.fetch.mockImplementation(async (url, init) => {
    if (String(url).endsWith("/auth/captcha"))
      return response({
        enabled: true,
        provider: "turnstile",
        siteKey: "test-key",
        mode: "testing",
      })
    if (init?.method === "POST")
      return failure
        ? response({ code: "INVALID_CREDENTIALS" }, 401)
        : response({ account: "admin_ops" })
    return response({ id: "admin-1", account: "admin_ops", status: "active" })
  })
})
afterEach(() => {
  Reflect.deleteProperty(window, "turnstile")
})

describe("admin Turnstile authentication", () => {
  it("refuses pending config and then requires an admin action token for every credential attempt", async () => {
    mount()
    submit()
    expect(posts()).toHaveLength(0)
    await waitFor(() => expect(widgets).toHaveLength(1))
    expect(widgets[0].options.action).toBe("admin_login")
    submit()
    expect(posts()).toHaveLength(0)
    act(() => widgets[0].options.callback("admin-first-token"))
    submit()
    submit()
    await waitFor(() => expect(posts()).toHaveLength(1))
    expect(posts()[0][0]).toBe("/admin/v1/auth/login")
    expect(JSON.parse(String(posts()[0][1]?.body))).toEqual({
      account: "admin_ops",
      password: "password",
      captchaToken: "admin-first-token",
    })
    await waitFor(() => expect(widgets).toHaveLength(2))
    expect(widgets[0].removed).toBe(true)
    expect(mocks.toast).toHaveBeenCalledWith("管理员登录已失效，请重新登录")
    act(() => widgets[0].options.callback("stale-token"))
    submit()
    expect(posts()).toHaveLength(1)
    act(() => widgets[1].options.callback("fresh-token"))
    submit()
    await waitFor(() => expect(posts()).toHaveLength(2))
    expect(JSON.parse(String(posts()[1][1]?.body)).captchaToken).toBe("fresh-token")
  })

  it.each([
    ["CAPTCHA_REQUIRED", "请先完成验证码验证"],
    ["CAPTCHA_INVALID", "验证码无效或已过期，请重新验证"],
    ["CAPTCHA_UNAVAILABLE", "验证码服务暂时不可用，请稍后重试"],
  ])("shows Chinese feedback for %s from the actual HTTP error", async (code, message) => {
    const get = mocks.fetch.getMockImplementation()
    mocks.fetch.mockImplementation(async (url, init) =>
      init?.method === "POST"
        ? response({ code }, code === "CAPTCHA_UNAVAILABLE" ? 503 : 400)
        : get!(url, init),
    )
    mount()
    await waitFor(() => expect(widgets).toHaveLength(1))
    act(() => widgets[0].options.callback("current-token"))
    submit()
    expect((await screen.findByRole("alert")).textContent).toBe(message)
    expect(mocks.toast).not.toHaveBeenCalled()
    expect(screen.getByLabelText("当前路径").textContent).toContain("/login")
    await waitFor(() => expect(widgets.length).toBeGreaterThan(1))
    submit()
    expect(posts()).toHaveLength(1)
  })

  it.each(["/membership?cursor=a%2Bb", "//outside.example"])(
    "preserves session refresh and safe redirect for %s",
    async (redirect) => {
      failure = false
      const client = mount(redirect)
      await waitFor(() => expect(widgets).toHaveLength(1))
      act(() => widgets[0].options.callback("success-token"))
      submit()
      await waitFor(() =>
        expect(screen.getByLabelText("当前路径").textContent).toBe(
          redirect.startsWith("//") ? "/users" : redirect,
        ),
      )
      expect(client.getQueryData(["admin-me"])).toMatchObject({ account: "admin_ops" })
    },
  )
})
