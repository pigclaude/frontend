// 负责迁移管理员密码验证码回归到真正的中央 Admin 交互，不创建旧私有登录会话。
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import type { TurnstileOptions } from "@pigclaude/web-ui/lib/turnstile-sdk"
import { InteractionPanel } from "@/components/identity/interaction-panel"
import { identityNavigation } from "@/lib/identity-api"
import { interaction, json } from "./identity-fixture"
const mocks = vi.hoisted(() => ({ fetch: vi.fn<typeof fetch>() }))
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("interactionId=interaction-1&realm=Admin"),
}))
const widgets: TurnstileOptions[] = []
let errorCode: string | null = "invalid_credentials"
beforeEach(() => {
  widgets.length = 0
  errorCode = "invalid_credentials"
  vi.stubGlobal("fetch", mocks.fetch)
  vi.spyOn(identityNavigation, "assign").mockImplementation(() => {})
  Object.assign(window, {
    turnstile: {
      render: (_node: HTMLElement, options: TurnstileOptions) => {
        widgets.push(options)
        return String(widgets.length)
      },
      remove: () => {},
    },
  })
  mocks.fetch.mockReset().mockImplementation(async (url, init) => {
    if (String(url) === "/admin/v1/auth/captcha")
      return json({
        enabled: true,
        provider: "turnstile",
        siteKey: widgets.length === 0 ? "first-key" : "changed-key",
        mode: "required",
      })
    if (init?.method === "POST")
      return errorCode
        ? json({ error: errorCode }, errorCode === "CAPTCHA_UNAVAILABLE" ? 503 : 400)
        : json({
            type: "redirect",
            redirect: "/admin/v1/web/oidc/callback?code=synthetic&state=synthetic",
          })
    return json(
      interaction({
        realm: "Admin",
        clientId: "pigclaude-admin",
        registrationAllowed: false,
        providers: [],
      }),
    )
  })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(window, "turnstile")
})
const posts = () => mocks.fetch.mock.calls.filter(([, init]) => init?.method === "POST")
const submit = () => fireEvent.submit(document.querySelector("form")!)
it("requires a fresh admin_login token for each attempt and preserves Admin-only password DTO", async () => {
  render(<InteractionPanel />)
  await screen.findByLabelText("密码")
  submit()
  expect(posts()).toHaveLength(0)
  await waitFor(() => expect(widgets).toHaveLength(1))
  expect(widgets[0].action).toBe("admin_login")
  expect(screen.queryByRole("button", { name: "注册" })).toBeNull()
  expect(screen.queryByText("Google")).toBeNull()
  fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "ops@example.test" } })
  fireEvent.change(screen.getByLabelText("密码"), { target: { value: "password" } })
  act(() => widgets[0].callback("first-proof"))
  submit()
  submit()
  await waitFor(() => expect(posts()).toHaveLength(1))
  expect(posts()[0][0]).toBe("/v1/identity/interactions/interaction-1/password")
  expect(JSON.parse(String(posts()[0][1]?.body))).toEqual({
    realm: "Admin",
    csrf: "csrf-marker",
    mode: "login",
    email: "ops@example.test",
    password: "password",
    captchaToken: "first-proof",
  })
  expect((await screen.findByRole("alert")).textContent).toBe("邮箱或密码不正确")
  await waitFor(() => expect(widgets.at(-1)?.sitekey).toBe("changed-key"))
  act(() => widgets[0].callback("stale-proof"))
  submit()
  expect(posts()).toHaveLength(1)
  errorCode = null
  act(() => widgets.at(-1)?.callback("fresh-proof"))
  submit()
  await waitFor(() =>
    expect(identityNavigation.assign).toHaveBeenCalledWith(
      "/admin/v1/web/oidc/callback?code=synthetic&state=synthetic",
    ),
  )
  expect(JSON.parse(String(posts()[1][1]?.body)).captchaToken).toBe("fresh-proof")
  expect(mocks.fetch.mock.calls.some(([url]) => String(url) === "/admin/v1/auth/login")).toBe(false)
})
it.each([
  ["CAPTCHA_REQUIRED", "请先完成验证码验证"],
  ["CAPTCHA_INVALID", "验证码无效或已过期，请重新验证"],
  ["CAPTCHA_UNAVAILABLE", "验证码服务暂时不可用，请稍后重试"],
])("keeps recoverable Chinese %s feedback in central Admin form", async (code, message) => {
  errorCode = code
  render(<InteractionPanel />)
  await waitFor(() => expect(widgets).toHaveLength(1))
  act(() => widgets[0].callback("proof"))
  submit()
  expect((await screen.findByRole("alert")).textContent).toBe(message)
  expect(identityNavigation.assign).not.toHaveBeenCalled()
  await waitFor(() => expect(widgets.length).toBeGreaterThan(1))
  submit()
  expect(posts()).toHaveLength(1)
})
