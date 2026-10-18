// 负责用真实 home 表单和 HTTP facade 验证 Turnstile 门禁及一次性 token。
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuthPanel } from "@/components/auth/auth-panel"
import type { TurnstileOptions } from "@pigclaude/web-ui/lib/turnstile-sdk"

const mocks = vi.hoisted(() => ({
  fetch: vi.fn<typeof fetch>(),
  push: vi.fn(),
  params: new URLSearchParams(),
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
  useSearchParams: () => mocks.params,
}))
vi.mock("@/lib/api", async () => {
  const { createClient } = await import("@pigclaude/api/client")
  const { createHomeApi } = await import("@pigclaude/api/home")
  return { homeApi: createHomeApi(createClient({ fetch: mocks.fetch })) }
})

const widgets: TurnstileOptions[] = []

function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function mount(initialMode: "login" | "register" = "login") {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <AuthPanel initialMode={initialMode} />
    </QueryClientProvider>,
  )
}

function submit() {
  fireEvent.submit(document.querySelector("form") as HTMLFormElement)
}

function posts() {
  return mocks.fetch.mock.calls.filter(([, init]) => init?.method === "POST")
}

function installSdk() {
  Object.assign(window, {
    turnstile: {
      render: (_container: HTMLElement, options: TurnstileOptions) => {
        widgets.push(options)
        return `widget-${widgets.length}`
      },
      remove: vi.fn(),
      reset: vi.fn(),
    },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  widgets.length = 0
  mocks.params = new URLSearchParams()
  installSdk()
  mocks.fetch.mockImplementation(async (url, init) => {
    if (String(url).endsWith("/auth/captcha"))
      return response({
        enabled: true,
        provider: "turnstile",
        siteKey: "test-key",
        mode: "testing",
      })
    if (init?.method === "POST") return response({ code: "INVALID_CREDENTIALS" }, 401)
    return response({})
  })
})

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(window, "turnstile")
  document.querySelectorAll("script[data-pigclaude-turnstile]").forEach((value) => value.remove())
})

describe("home Turnstile auth boundary", () => {
  it("keeps a failed config closed and retries the actual public endpoint", async () => {
    mocks.fetch.mockResolvedValueOnce(response({ code: "CAPTCHA_UNAVAILABLE" }, 503))
    mount()
    expect((await screen.findByRole("alert")).textContent).toContain("验证码配置暂时无法加载")
    submit()
    expect(posts()).toHaveLength(0)
    fireEvent.click(screen.getByRole("button", { name: "重试验证码" }))
    await waitFor(() => expect(widgets).toHaveLength(1))
    expect(mocks.fetch.mock.calls.filter(([url]) => url === "/v1/auth/captcha")).toHaveLength(2)
    act(() => widgets[0].callback("recovered-token"))
    submit()
    await waitFor(() => expect(posts()).toHaveLength(1))
  })

  it("blocks SDK failure and retries by loading a fresh official script", async () => {
    Reflect.deleteProperty(window, "turnstile")
    mount()
    await waitFor(() =>
      expect(document.querySelector("script[data-pigclaude-turnstile]")).toBeTruthy(),
    )
    act(() =>
      document.querySelector("script[data-pigclaude-turnstile]")?.dispatchEvent(new Event("error")),
    )
    expect((await screen.findByRole("alert")).textContent).toContain("验证码组件加载失败")
    submit()
    expect(posts()).toHaveLength(0)
    fireEvent.click(screen.getByRole("button", { name: "重试验证码" }))
    await waitFor(() =>
      expect(document.querySelector("script[data-pigclaude-turnstile]")).toBeTruthy(),
    )
    installSdk()
    act(() =>
      document.querySelector("script[data-pigclaude-turnstile]")?.dispatchEvent(new Event("load")),
    )
    await waitFor(() => expect(widgets).toHaveLength(1))
    act(() => widgets[0].callback("sdk-recovered-token"))
    submit()
    await waitFor(() => expect(posts()).toHaveLength(1))
  })

  it("clears an expired token and isolates login/register tab callbacks", async () => {
    mount()
    await waitFor(() => expect(widgets).toHaveLength(1))
    act(() => widgets[0].callback("expired-token"))
    act(() => widgets[0]["expired-callback"]())
    submit()
    expect(posts()).toHaveLength(0)
    expect((await screen.findByRole("alert")).textContent).toContain("验证码已过期")
    fireEvent.click(screen.getByRole("button", { name: "重试验证码" }))
    await waitFor(() => expect(widgets).toHaveLength(2))
    act(() => widgets[1].callback("login-only-token"))
    fireEvent.keyDown(screen.getByRole("tab", { name: "注册" }), { key: "Enter" })
    await waitFor(() => expect(widgets).toHaveLength(3))
    expect(widgets[2].action).toBe("home_register")
    act(() => widgets[1].callback("late-login-token"))
    submit()
    expect(posts()).toHaveLength(0)
    act(() => widgets[2].callback("register-token"))
    submit()
    await waitFor(() => expect(posts()).toHaveLength(1))
    expect(posts()[0][0]).toBe("/v1/auth/register")
    expect(JSON.parse(String(posts()[0][1]?.body)).captchaToken).toBe("register-token")
  })

  it.each([
    ["CAPTCHA_REQUIRED", "请先完成验证码验证"],
    ["CAPTCHA_INVALID", "验证码无效或已过期，请重新验证"],
    ["CAPTCHA_UNAVAILABLE", "验证码服务暂时不可用，请稍后重试"],
  ])("renders Chinese feedback for actual %s HTTP errors", async (code, message) => {
    const get = mocks.fetch.getMockImplementation()
    mocks.fetch.mockImplementation(async (url, init) =>
      init?.method === "POST"
        ? response({ code }, code === "CAPTCHA_UNAVAILABLE" ? 503 : 400)
        : get!(url, init),
    )
    mount()
    await waitFor(() => expect(widgets).toHaveLength(1))
    act(() => widgets[0].callback("current-token"))
    submit()
    expect((await screen.findByRole("alert")).textContent).toBe(message)
    expect(mocks.push).not.toHaveBeenCalled()
    await waitFor(() => expect(widgets.length).toBeGreaterThan(1))
    submit()
    expect(posts()).toHaveLength(1)
  })

  it.each(["login", "register"] as const)(
    "keeps redirect state bytes after successful %s",
    async (mode) => {
      const redirect = "/authorize/flow-1?state=a%2Bb%2520%26%3D%2F"
      mocks.params.set("redirect", redirect)
      const get = mocks.fetch.getMockImplementation()
      mocks.fetch.mockImplementation(async (url, init) =>
        init?.method === "POST" ? response({ id: "user-1" }) : get!(url, init),
      )
      mount(mode)
      await waitFor(() => expect(widgets).toHaveLength(1))
      act(() => widgets[0].callback("redirect-token"))
      submit()
      await waitFor(() => expect(mocks.push).toHaveBeenCalledWith(redirect))
      expect(mocks.fetch.mock.calls.map(([url]) => url)).toContain("/v1/user/me")
      expect(mocks.fetch.mock.calls.map(([url]) => url)).toContain("/v1/entitlement")
    },
  )

  it("refuses submit while configuration is loading", async () => {
    mocks.fetch.mockImplementation(() => new Promise<Response>(() => undefined))
    mount()
    submit()
    await act(async () => undefined)
    expect(posts()).toHaveLength(0)
    expect((document.querySelector("button[type=submit]") as HTMLButtonElement).disabled).toBe(true)
  })

  it.each([
    ["login", "home_login", "/v1/auth/login"],
    ["register", "home_register", "/v1/auth/register"],
  ] as const)(
    "sends the current %s token once and requires a new token after credential failure",
    async (mode, action, path) => {
      mount(mode)
      fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "ada@example.com" } })
      fireEvent.change(screen.getByLabelText("密码"), { target: { value: "password" } })
      if (mode === "register")
        fireEvent.change(screen.getByLabelText("昵称"), { target: { value: "Ada" } })
      await waitFor(() => expect(widgets).toHaveLength(1))
      expect(widgets[0].action).toBe(action)
      submit()
      expect(posts()).toHaveLength(0)
      act(() => widgets[0].callback("first-token"))
      submit()
      submit()
      await waitFor(() => expect(posts()).toHaveLength(1))
      expect(posts()[0][0]).toBe(path)
      expect(JSON.parse(String(posts()[0][1]?.body))).toEqual({
        email: "ada@example.com",
        password: "password",
        ...(mode === "register" ? { nickname: "Ada" } : {}),
        captchaToken: "first-token",
      })
      await waitFor(() => expect(widgets).toHaveLength(2))
      act(() => widgets[0].callback("late-old-token"))
      submit()
      expect(posts()).toHaveLength(1)
      act(() => widgets[1].callback("new-token"))
      submit()
      await waitFor(() => expect(posts()).toHaveLength(2))
      expect(JSON.parse(String(posts()[1][1]?.body)).captchaToken).toBe("new-token")
    },
  )
})
