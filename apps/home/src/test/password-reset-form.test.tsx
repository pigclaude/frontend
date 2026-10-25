// 负责忘记密码三步流程：邮箱发码、验证码与两次新密码、回到登录表单并预填邮箱。
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
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

function serve() {
  mocks.fetch.mockImplementation(async (url) => {
    const target = String(url)
    if (target.endsWith("/v1/auth/captcha")) return disabledCaptcha()
    if (target.endsWith("/email-code")) return json({ type: "sent", resendAfterSeconds: 60 })
    if (target.endsWith("/password-reset")) return json({ type: "password_reset" })
    return json(interaction())
  })
}

function posts(suffix: string) {
  return mocks.fetch.mock.calls.filter(
    ([url, init]) => init?.method === "POST" && String(url).endsWith(suffix),
  )
}

/** 从登录表单进入忘记密码并发码，停在验证码步骤。 */
async function reachCodeStep(email = "user@example.com") {
  render(<InteractionPanel />)
  await screen.findByLabelText("邮箱")
  fireEvent.click(screen.getByRole("button", { name: "忘记密码？" }))
  expect(screen.getByRole("heading").textContent).toBe("重设密码")
  fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: email } })
  const sendButton = screen.getByRole("button", { name: "发送验证码" }) as HTMLButtonElement
  await waitFor(() => expect(sendButton.disabled).toBe(false))
  fireEvent.click(sendButton)
  await screen.findByLabelText("新密码")
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

describe("forgot password", () => {
  it("walks email → code+password → back to login with email prefilled", async () => {
    await reachCodeStep()

    const codePost = posts("/email-code")
    expect(codePost).toHaveLength(1)
    expect(JSON.parse(String(codePost[0][1]?.body))).toEqual({
      realm: "User",
      csrf: "csrf-marker",
      purpose: "reset_password",
      email: "user@example.com",
    })

    fireEvent.change(screen.getByLabelText("验证码"), { target: { value: "123456" } })
    fireEvent.change(screen.getByLabelText("新密码"), { target: { value: "new-password" } })
    fireEvent.change(screen.getByLabelText("确认新密码"), {
      target: { value: "new-password" },
    })
    fireEvent.click(screen.getByRole("button", { name: "重设密码" }))

    expect(await screen.findByText("密码已重设，请用新密码登录")).toBeTruthy()
    expect(screen.getByRole("heading").textContent).toBe("登录 PigClaude")
    expect((screen.getByLabelText("邮箱") as HTMLInputElement).value).toBe("user@example.com")
    const resetPost = posts("/password-reset")
    expect(resetPost).toHaveLength(1)
    expect(JSON.parse(String(resetPost[0][1]?.body))).toEqual({
      realm: "User",
      csrf: "csrf-marker",
      email: "user@example.com",
      emailCode: "123456",
      newPassword: "new-password",
    })
    // 重设不会创建网站会话或跳转。
    expect(identityNavigation.assign).not.toHaveBeenCalled()
  })

  it("rejects mismatched new passwords locally", async () => {
    await reachCodeStep()
    fireEvent.change(screen.getByLabelText("验证码"), { target: { value: "123456" } })
    fireEvent.change(screen.getByLabelText("新密码"), { target: { value: "new-password" } })
    fireEvent.change(screen.getByLabelText("确认新密码"), {
      target: { value: "other-password" },
    })
    fireEvent.click(screen.getByRole("button", { name: "重设密码" }))

    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toBe("两次输入的密码不一致")
    expect(posts("/password-reset")).toHaveLength(0)
    expect(screen.getByLabelText("验证码")).toBeTruthy()
    await waitFor(() => expect(screen.queryByText("密码已重设，请用新密码登录")).toBeNull())
  })
})
