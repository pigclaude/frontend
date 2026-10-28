// 负责通过中央身份页面和实际 HTTP 请求验证注册、找回发码结果只归属未被编辑的邮箱。
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { InteractionPanel } from "@/components/identity/interaction-panel"
import { createDeferredIdentityHttp } from "./identity-email-code-http-fixture"

const mocks = vi.hoisted(() => ({
  params: new URLSearchParams("interactionId=interaction-1&realm=User"),
}))
vi.mock("next/navigation", () => ({ useSearchParams: () => mocks.params }))

let http: ReturnType<typeof createDeferredIdentityHttp>

beforeEach(() => {
  mocks.params = new URLSearchParams("interactionId=interaction-1&realm=User")
  http = createDeferredIdentityHttp()
  vi.stubGlobal("fetch", http.fetch)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("email-code response ownership", () => {
  it("注册发给 A 的旧成功不能给等待期间编辑的 B 施加冷却", async () => {
    render(<InteractionPanel />)
    await screen.findByLabelText("邮箱")
    fireEvent.click(screen.getByRole("button", { name: "注册" }))
    await screen.findByLabelText("验证码")
    fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "first@example.test" } })
    const send = screen.getByRole("button", { name: "发送验证码" }) as HTMLButtonElement
    await waitFor(() => expect(send.disabled).toBe(false))
    fireEvent.click(send)
    await waitFor(() => expect(http.requests).toHaveLength(1))

    const oldRequest = http.requests[0]
    expect(oldRequest.path).toBe("/v1/identity/interactions/interaction-1/email-code")
    expect(oldRequest.body).toEqual({
      realm: "User",
      csrf: "csrf-marker",
      purpose: "register",
      email: "first@example.test",
    })
    const email = screen.getByLabelText("邮箱") as HTMLInputElement
    expect(email.disabled || email.readOnly).toBe(false)
    fireEvent.change(email, { target: { value: "second@example.test" } })

    await act(async () => {
      oldRequest.respond({ type: "sent", resendAfterSeconds: 60 })
    })

    expect((screen.getByLabelText("邮箱") as HTMLInputElement).value).toBe("second@example.test")
    expect(screen.queryByRole("button", { name: /秒后重发$/ })).toBeNull()
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "发送验证码" }) as HTMLButtonElement).disabled,
      ).toBe(false),
    )
  })

  it("找回发给 A 的旧成功不能把编辑后的 B 推进到验证码步骤", async () => {
    render(<InteractionPanel />)
    await screen.findByLabelText("邮箱")
    fireEvent.click(screen.getByRole("button", { name: "忘记密码？" }))
    fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "first@example.test" } })
    const send = screen.getByRole("button", { name: "发送验证码" }) as HTMLButtonElement
    await waitFor(() => expect(send.disabled).toBe(false))
    fireEvent.click(send)
    await waitFor(() => expect(http.requests).toHaveLength(1))
    expect(http.requests[0].body).toEqual({
      realm: "User",
      csrf: "csrf-marker",
      purpose: "reset_password",
      email: "first@example.test",
    })
    fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "second@example.test" } })

    await act(async () => {
      http.requests[0].respond({ type: "sent", resendAfterSeconds: 60 })
    })

    expect(screen.queryByLabelText("新密码")).toBeNull()
    expect(screen.queryByText(/验证码已发送至/)).toBeNull()
    expect((screen.getByLabelText("邮箱") as HTMLInputElement).value).toBe("second@example.test")
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "发送验证码" }) as HTMLButtonElement).disabled,
      ).toBe(false),
    )
  })
})
