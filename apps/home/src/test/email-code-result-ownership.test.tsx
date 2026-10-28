// 负责通过中央身份页面与延迟 HTTP 验证旧发码错误、往返编辑和组件替换的结果隔离。
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { InteractionPanel } from "@/components/identity/interaction-panel"
import {
  createDeferredIdentityHttp,
  type PendingIdentityRequest,
} from "./identity-email-code-http-fixture"

const mocks = vi.hoisted(() => ({
  params: new URLSearchParams("interactionId=interaction-1&realm=User"),
}))
vi.mock("next/navigation", () => ({ useSearchParams: () => mocks.params }))

const modes = ["register", "reset"] as const
const failures = ["429", "HTTP 错误", "网络失败"] as const
const outcomes = ["成功", ...failures] as const
const replacements = ["换交互", "卸载重挂"] as const
type Mode = (typeof modes)[number]
type Outcome = (typeof outcomes)[number]

let http: ReturnType<typeof createDeferredIdentityHttp>

function button(name: string) {
  return screen.getByRole("button", { name }) as HTMLButtonElement
}

function changeEmail(email: string) {
  fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: email } })
}

async function openMode(mode: Mode) {
  await screen.findByLabelText("邮箱")
  fireEvent.click(button(mode === "register" ? "注册" : "忘记密码？"))
  if (mode === "register") await screen.findByLabelText("验证码")
  else expect(screen.getByRole("heading").textContent).toBe("重设密码")
}

async function sendCode(mode: Mode, email: string) {
  const previousRequests = http.requests.length
  changeEmail(email)
  await waitFor(() => expect(button("发送验证码").disabled).toBe(false))
  fireEvent.click(button("发送验证码"))
  await waitFor(() => expect(http.requests).toHaveLength(previousRequests + 1))
  const request = http.requests[previousRequests]
  expect(request.path).toBe(
    `/v1/identity/interactions/${mocks.params.get("interactionId")}/email-code`,
  )
  expect(request.body).toEqual({
    realm: "User",
    csrf: "csrf-marker",
    purpose: mode === "register" ? "register" : "reset_password",
    email,
  })
  return request
}

async function settle(request: PendingIdentityRequest, outcome: Outcome) {
  await act(async () => {
    if (outcome === "成功") request.respond({ type: "sent", resendAfterSeconds: 60 })
    else if (outcome === "429")
      request.respond({ code: "EMAIL_CODE_RATE_LIMITED", metadata: { retryAfterSeconds: 37 } }, 429)
    else if (outcome === "HTTP 错误") request.respond({ code: "MAIL_SEND_FAILED" }, 503)
    else request.reject(new Error("synthetic-network-failure"))
  })
}

async function expectUnsentDraft(email: string) {
  await waitFor(() => {
    expect((screen.getByLabelText("邮箱") as HTMLInputElement).value).toBe(email)
    expect(screen.queryByRole("alert")).toBeNull()
    expect(screen.queryByRole("button", { name: /秒后重发$/ })).toBeNull()
    expect(screen.queryByText(/验证码已发送至/)).toBeNull()
    expect(screen.queryByLabelText("新密码")).toBeNull()
    expect(button("发送验证码").disabled).toBe(false)
  })
}

beforeEach(() => {
  mocks.params = new URLSearchParams("interactionId=interaction-1&realm=User")
  http = createDeferredIdentityHttp()
  vi.stubGlobal("fetch", http.fetch)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe.each(modes)("%s 发码结果归属", (mode) => {
  it.each(failures)("A 的旧%s不会影响等待时改成的 B", async (outcome) => {
    render(<InteractionPanel />)
    await openMode(mode)
    const oldRequest = await sendCode(mode, "first@example.test")
    changeEmail("second@example.test")

    await settle(oldRequest, outcome)

    await expectUnsentDraft("second@example.test")
  })

  it.each(outcomes)("A → B → A 后旧%s不重新取得当前邮箱的归属", async (outcome) => {
    render(<InteractionPanel />)
    await openMode(mode)
    const oldRequest = await sendCode(mode, "first@example.test")
    changeEmail("second@example.test")
    changeEmail("first@example.test")

    await settle(oldRequest, outcome)

    await expectUnsentDraft("first@example.test")
  })

  describe.each(replacements)("%s", (replacement) => {
    it.each(outcomes)("旧%s不能更新新组件里的邮箱草稿", async (outcome) => {
      const oldView = render(<InteractionPanel />)
      await openMode(mode)
      const oldRequest = await sendCode(mode, "first@example.test")
      if (replacement === "换交互") {
        mocks.params = new URLSearchParams("interactionId=interaction-2&realm=User")
        oldView.rerender(<InteractionPanel />)
      } else {
        oldView.unmount()
        render(<InteractionPanel />)
      }
      await openMode(mode)
      changeEmail("second@example.test")

      await settle(oldRequest, outcome)

      await expectUnsentDraft("second@example.test")
    })
  })
})

describe("找回密码的新请求等待状态", () => {
  it.each(outcomes)("新交互发码期间旧%s的 finally 不能解除等待", async (outcome) => {
    const view = render(<InteractionPanel />)
    await openMode("reset")
    const oldRequest = await sendCode("reset", "first@example.test")
    mocks.params = new URLSearchParams("interactionId=interaction-2&realm=User")
    view.rerender(<InteractionPanel />)
    await openMode("reset")
    const currentRequest = await sendCode("reset", "second@example.test")
    expect(button("返回登录").disabled).toBe(true)

    await settle(oldRequest, outcome)

    // 返回登录由表单 pending 禁用，可独立观察它没有被旧结果或清理提前解锁。
    expect(button("返回登录").disabled).toBe(true)
    expect(button("发送验证码").disabled).toBe(true)
    fireEvent.click(button("返回登录"))
    expect(screen.getByRole("heading").textContent).toBe("重设密码")
    expect(screen.queryByRole("alert")).toBeNull()
    expect(screen.queryByText(/验证码已发送至/)).toBeNull()
    expect((screen.getByLabelText("邮箱") as HTMLInputElement).value).toBe("second@example.test")

    await settle(currentRequest, "成功")

    expect(await screen.findByText("验证码已发送至 second@example.test")).toBeTruthy()
    expect(screen.getByLabelText("新密码")).toBeTruthy()
  })
})
