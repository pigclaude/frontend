// 负责用中央 OP 密码表单和真实 HTTP client 验证验证码门禁与一次性 token。
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { InteractionPanel } from "@/components/identity/interaction-panel"
import { identityNavigation } from "@/lib/identity-api"
import { interaction } from "./identity-fixture"
import type { TurnstileOptions } from "@pigclaude/web-ui/lib/turnstile-sdk"

const mocks = vi.hoisted(() => ({
  fetch: vi.fn<typeof fetch>(),
  push: vi.fn(),
  params: new URLSearchParams(),
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
  useSearchParams: () => {
    const params = new URLSearchParams(mocks.params)
    params.set("interactionId", "interaction-1")
    params.set("realm", "User")
    return params
  },
}))
const widgets: TurnstileOptions[] = []

function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  })
}

async function mount(initialMode: "login" | "register" = "login") {
  if (initialMode === "register")
    sessionStorage.setItem(
      "pigclaude:registration-ui",
      JSON.stringify({ mode: "register", createdAt: Date.now() }),
    )
  const view = render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <InteractionPanel />
    </QueryClientProvider>,
  )
  await screen.findByLabelText("密码")
  return view
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
  vi.stubGlobal("fetch", mocks.fetch)
  vi.spyOn(identityNavigation, "assign").mockImplementation(mocks.push)
  sessionStorage.clear()
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
    if (String(url).endsWith("/v1/auth/mail-status")) return response({ available: true })
    if (init?.method === "POST") return response({ code: "INVALID_CREDENTIALS" }, 401)
    return response(interaction())
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  Reflect.deleteProperty(window, "turnstile")
  document.querySelectorAll("script[data-pigclaude-turnstile]").forEach((value) => value.remove())
})

describe("home Turnstile auth boundary", () => {
  it("注册只在人机验证后发码，填入邮件验证码即可提交", async () => {
    const get = mocks.fetch.getMockImplementation()!
    mocks.fetch.mockImplementation(async (url, init) =>
      String(url).endsWith("/email-code")
        ? response({ type: "sent", resendAfterSeconds: 60 }, 202)
        : get(url, init),
    )
    await mount("register")
    await waitFor(() => expect(widgets.some((widget) => widget.action === "email_code")).toBe(true))
    expect(screen.getAllByLabelText("安全验证")).toHaveLength(1)
    expect(widgets.map((widget) => widget.action)).toEqual(["email_code"])

    fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "ada@example.com" } })
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "password" } })
    const send = screen.getByRole("button", { name: "发送验证码" }) as HTMLButtonElement
    expect(send.disabled).toBe(true)
    act(() => widgets[0].callback("email-code-proof"))
    fireEvent.click(send)
    await screen.findByRole("button", { name: /秒后重发/ })
    expect(screen.queryByLabelText("安全验证")).toBeNull()
    expect(posts()).toHaveLength(1)
    expect(posts()[0][0]).toBe("/v1/identity/interactions/interaction-1/email-code")
    expect(JSON.parse(String(posts()[0][1]?.body)).captchaToken).toBe("email-code-proof")

    const register = screen.getByRole("button", { name: "创建账号" }) as HTMLButtonElement
    expect(register.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText("验证码"), { target: { value: "123456" } })
    fireEvent.click(register)
    await waitFor(() => expect(posts()).toHaveLength(2))
    expect(posts()[1][0]).toBe("/v1/identity/interactions/interaction-1/password")
    expect(JSON.parse(String(posts()[1][1]?.body))).toEqual({
      realm: "User",
      csrf: "csrf-marker",
      mode: "register",
      email: "ada@example.com",
      password: "password",
      emailCode: "123456",
    })
  })

  it("冷却结束后只在用户请求重发时重新展示人机验证", async () => {
    const get = mocks.fetch.getMockImplementation()!
    mocks.fetch.mockImplementation(async (url, init) =>
      String(url).endsWith("/email-code")
        ? response({ type: "sent", resendAfterSeconds: 1 }, 202)
        : get(url, init),
    )
    await mount("register")
    await waitFor(() => expect(widgets).toHaveLength(1))
    fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "ada@example.com" } })
    act(() => widgets[0].callback("first-email-proof"))
    vi.useFakeTimers()
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "发送验证码" }))
    })
    expect(posts()).toHaveLength(1)
    expect(screen.queryByLabelText("安全验证")).toBeNull()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    expect(screen.queryByLabelText("安全验证")).toBeNull()

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "发送验证码" }))
    })
    expect(screen.getAllByLabelText("安全验证")).toHaveLength(1)
    expect(posts()).toHaveLength(1)
    act(() => widgets[1].callback("resend-email-proof"))
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "发送验证码" }))
    })
    expect(posts()).toHaveLength(2)
    expect(JSON.parse(String(posts()[1][1]?.body)).captchaToken).toBe("resend-email-proof")
  })

  it("settled_auth_reloads_changed_site_key", async () => {
    let reads = 0
    mocks.params = new URLSearchParams("redirect=%2Faccount%3Fcursor%3Da%252Bb&state=byte%2Bexact")
    mocks.fetch.mockImplementation(async (url, init) =>
      !String(url).endsWith("captcha") && init?.method !== "POST"
        ? response(interaction())
        : init?.method === "POST"
          ? response({ code: "INVALID_CREDENTIALS" }, 401)
          : response({
              enabled: true,
              provider: "turnstile",
              siteKey: ++reads === 1 ? "first-key" : "changed-key",
              mode: "required",
            }),
    )
    await mount()
    fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "test@example.com" } })
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "password" } })
    await waitFor(() => expect(widgets).toHaveLength(1))
    act(() => widgets[0].callback("first-proof"))
    submit()
    await waitFor(() => expect(widgets.at(-1)?.sitekey).toBe("changed-key"))
    act(() => widgets[0].callback("late-proof"))
    submit()
    expect(posts()).toHaveLength(1)
    expect(mocks.params.toString()).toBe(
      "redirect=%2Faccount%3Fcursor%3Da%252Bb&state=byte%2Bexact",
    )
  })
  it("keeps a failed config closed and retries the actual public endpoint", async () => {
    const normal = mocks.fetch.getMockImplementation()!
    let failedConfig = false
    mocks.fetch.mockImplementation(async (url, init) => {
      if (String(url).endsWith("captcha") && !failedConfig) {
        failedConfig = true
        return response({ code: "CAPTCHA_UNAVAILABLE" }, 503)
      }
      return normal(url, init)
    })
    await mount()
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
    await mount()
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
    await mount()
    await waitFor(() => expect(widgets).toHaveLength(1))
    act(() => widgets[0].callback("expired-token"))
    act(() => widgets[0]["expired-callback"]())
    submit()
    expect(posts()).toHaveLength(0)
    expect((await screen.findByRole("alert")).textContent).toContain("验证码已过期")
    fireEvent.click(screen.getByRole("button", { name: "重试验证码" }))
    await waitFor(() => expect(widgets).toHaveLength(2))
    act(() => widgets[1].callback("login-only-token"))
    fireEvent.click(screen.getByRole("button", { name: "注册" }))
    await waitFor(() => expect(widgets.some((widget) => widget.action === "email_code")).toBe(true))
    fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "ada@example.com" } })
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "password" } })
    act(() => widgets[1].callback("late-login-token"))
    fireEvent.click(screen.getByRole("button", { name: "发送验证码" }))
    expect(posts()).toHaveLength(0)

    fireEvent.click(screen.getByRole("button", { name: "登录" }))
    await waitFor(() => expect(widgets.at(-1)?.action).toBe("home_login"))
    submit()
    expect(posts()).toHaveLength(0)
    act(() => widgets.at(-1)?.callback("new-login-token"))
    submit()
    await waitFor(() => expect(posts()).toHaveLength(1))
    expect(posts()[0][0]).toBe("/v1/identity/interactions/interaction-1/password")
    const body = JSON.parse(String(posts()[0][1]?.body))
    expect(body.mode).toBe("login")
    expect(body.captchaToken).toBe("new-login-token")
  })

  it.each([
    ["CAPTCHA_REQUIRED", "请先完成验证码验证"],
    ["CAPTCHA_INVALID", "验证码无效或已过期，请重新验证"],
    ["CAPTCHA_UNAVAILABLE", "验证码服务暂时不可用，请稍后重试"],
  ])("renders Chinese feedback for actual %s HTTP errors", async (code, message) => {
    const get = mocks.fetch.getMockImplementation()
    mocks.fetch.mockImplementation(async (url, init) =>
      init?.method === "POST"
        ? response({ error: code }, code === "CAPTCHA_UNAVAILABLE" ? 503 : 400)
        : get!(url, init),
    )
    await mount()
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
        init?.method === "POST" ? response({ type: "redirect", redirect }) : get!(url, init),
      )
      await mount(mode)
      fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "ada@example.com" } })
      fireEvent.change(screen.getByLabelText("密码"), { target: { value: "password" } })
      if (mode === "register") {
        fireEvent.change(screen.getByLabelText("验证码"), { target: { value: "123456" } })
        await waitFor(() =>
          expect(
            (screen.getByRole("button", { name: "创建账号" }) as HTMLButtonElement).disabled,
          ).toBe(false),
        )
      } else {
        await waitFor(() => expect(widgets).toHaveLength(1))
        act(() => widgets[0].callback("redirect-token"))
      }
      submit()
      await waitFor(() => expect(mocks.push).toHaveBeenCalledWith(redirect))
      expect(mocks.fetch.mock.calls.map(([url]) => url)).not.toContain("/v1/user/me")
      expect(mocks.fetch.mock.calls.map(([url]) => url)).not.toContain("/v1/entitlement")
    },
  )

  it("refuses submit while configuration is loading", async () => {
    mocks.fetch.mockImplementation(async (url) =>
      String(url).endsWith("captcha")
        ? new Promise<Response>(() => undefined)
        : response(interaction()),
    )
    await mount()
    await screen.findByLabelText("密码")
    submit()
    await act(async () => undefined)
    expect(posts()).toHaveLength(0)
    expect((document.querySelector("button[type=submit]") as HTMLButtonElement).disabled).toBe(true)
  })

  it("sends the login token once and requires a new token after credential failure", async () => {
    await mount()
    fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "ada@example.com" } })
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "password" } })
    await waitFor(() => expect(widgets).toHaveLength(1))
    submit()
    expect(posts()).toHaveLength(0)
    act(() => widgets[0].callback("first-token"))
    submit()
    submit()
    await waitFor(() => expect(posts()).toHaveLength(1))
    expect(posts()[0][0]).toBe("/v1/identity/interactions/interaction-1/password")
    expect(JSON.parse(String(posts()[0][1]?.body))).toEqual({
      email: "ada@example.com",
      password: "password",
      realm: "User",
      csrf: "csrf-marker",
      mode: "login",
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
  })
})
