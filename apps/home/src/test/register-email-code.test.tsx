// 负责注册邮箱验证码：提交门禁、发送倒计时、429 等待和邮件不可用提示。
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { InteractionPanel } from "@/components/identity/interaction-panel"
import { identityNavigation } from "@/lib/identity-api"
import { interaction, json } from "./identity-fixture"

const mocks = vi.hoisted(() => ({
  params: new URLSearchParams("interactionId=interaction-1&realm=User"),
  fetch: vi.fn<typeof fetch>(),
}))
vi.mock("next/navigation", () => ({ useSearchParams: () => mocks.params }))

const disabledCaptcha = () =>
  json({ enabled: false, provider: "turnstile", siteKey: null, mode: "disabled" })

function serve({
  available = true,
  codeResponse = () => json({ type: "sent", resendAfterSeconds: 60 }),
}: {
  available?: boolean
  codeResponse?: () => Response
} = {}) {
  mocks.fetch.mockImplementation(async (url, init) => {
    const target = String(url)
    if (target.endsWith("/v1/auth/mail-status")) return json({ available })
    if (target.endsWith("/auth/captcha")) return disabledCaptcha()
    if (target.endsWith("/email-code")) return codeResponse()
    if (init?.method === "POST") {
      return json({
        type: "redirect",
        redirect: "/v1/web/oidc/callback?code=synthetic&state=a%2Bb%2520",
      })
    }
    return json(interaction())
  })
}

function posts(suffix: string) {
  return mocks.fetch.mock.calls.filter(
    ([url, init]) => init?.method === "POST" && String(url).endsWith(suffix),
  )
}

function submitButton() {
  return screen.getByRole("button", { name: "创建账号" }) as HTMLButtonElement
}

beforeEach(() => {
  mocks.params = new URLSearchParams("interactionId=interaction-1&realm=User")
  vi.stubGlobal("fetch", mocks.fetch)
  vi.spyOn(identityNavigation, "assign").mockImplementation(() => undefined)
  serve()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  mocks.fetch.mockReset()
})

describe("register email code", () => {
  it("requires a code before the register button enables", async () => {
    render(<InteractionPanel />)
    await screen.findByLabelText("邮箱")
    fireEvent.click(screen.getByRole("button", { name: "注册" }))
    await screen.findByLabelText("验证码")
    fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "new@example.com" } })
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "password-value" } })
    await waitFor(() => expect(submitButton().disabled).toBe(true))

    fireEvent.change(screen.getByLabelText("验证码"), { target: { value: "123456" } })
    await waitFor(() => expect(submitButton().disabled).toBe(false))
    fireEvent.submit(document.querySelector("form")!)
    await waitFor(() => expect(posts("/password")).toHaveLength(1))
    expect(JSON.parse(String(posts("/password")[0][1]?.body))).toEqual({
      realm: "User",
      csrf: "csrf-marker",
      mode: "register",
      email: "new@example.com",
      password: "password-value",
      emailCode: "123456",
    })
  })

  it("counts down 60 seconds after sending and honours retryAfterSeconds on 429", async () => {
    vi.useFakeTimers()
    let codeResponse = () => json({ type: "sent", resendAfterSeconds: 60 })
    serve({ codeResponse: () => codeResponse() })
    render(<InteractionPanel />)
    await vi.waitFor(() => screen.getByLabelText("邮箱"))
    fireEvent.click(screen.getByRole("button", { name: "注册" }))
    fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "new@example.com" } })
    await vi.waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "发送验证码" }) as HTMLButtonElement).disabled,
      ).toBe(false),
    )
    fireEvent.click(screen.getByRole("button", { name: "发送验证码" }))
    await vi.waitFor(() => expect(screen.getByRole("button", { name: "60 秒后重发" })).toBeTruthy())
    expect(posts("/email-code")).toHaveLength(1)
    expect(JSON.parse(String(posts("/email-code")[0][1]?.body))).toEqual({
      realm: "User",
      csrf: "csrf-marker",
      purpose: "register",
      email: "new@example.com",
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    expect(screen.getByRole("button", { name: "59 秒后重发" })).toBeTruthy()
    // 冷却绑定当前地址：换邮箱后立即允许为新地址发码。
    fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "second@example.com" } })
    await vi.waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "发送验证码" }) as HTMLButtonElement).disabled,
      ).toBe(false),
    )

    codeResponse = () =>
      json({ code: "EMAIL_CODE_RATE_LIMITED", metadata: { retryAfterSeconds: 7 } }, 429)
    fireEvent.click(screen.getByRole("button", { name: "发送验证码" }))
    await vi.waitFor(() => expect(screen.getByRole("button", { name: "7 秒后重发" })).toBeTruthy())
    expect(JSON.parse(String(posts("/email-code")[1][1]?.body)).email).toBe("second@example.com")
  })

  it("shows the unavailable notice when mail is not configured", async () => {
    serve({ available: false })
    render(<InteractionPanel />)
    await screen.findByLabelText("邮箱")
    fireEvent.click(screen.getByRole("button", { name: "注册" }))
    expect(await screen.findByText("邮箱注册暂未开放，可以用 Google 或 GitHub 注册")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "创建账号" })).toBeNull()
    expect(screen.queryByLabelText("邮箱")).toBeNull()
    expect(screen.queryByLabelText("验证码")).toBeNull()
  })
})
