// 负责当前邮箱发码的排他门禁、正常目标提交、冷却和错误重试。
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { InteractionPanel } from "@/components/identity/interaction-panel"
import { identityNavigation } from "@/lib/identity-api"
import {
  createDeferredIdentityHttp,
  type PendingIdentityRequest,
} from "./identity-email-code-http-fixture"

const mocks = vi.hoisted(() => ({
  params: new URLSearchParams("interactionId=interaction-1&realm=User"),
}))
vi.mock("next/navigation", () => ({ useSearchParams: () => mocks.params }))

const modes = ["register", "reset"] as const
type Mode = (typeof modes)[number]
let http: ReturnType<typeof createDeferredIdentityHttp>

function button(name: string) {
  return screen.getByRole("button", { name }) as HTMLButtonElement
}

function changeField(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

async function openFlow(mode: Mode, email = "first@example.test") {
  const view = render(<InteractionPanel />)
  await screen.findByLabelText("邮箱")
  fireEvent.click(button(mode === "register" ? "注册" : "忘记密码？"))
  if (mode === "register") await screen.findByLabelText("验证码")
  changeField("邮箱", email)
  await waitFor(() => expect(button("发送验证码").disabled).toBe(false))
  return view
}

async function sendCode() {
  const previousRequests = http.requests.length
  await waitFor(() => expect(button("发送验证码").disabled).toBe(false))
  fireEvent.click(button("发送验证码"))
  await waitFor(() => expect(http.requests).toHaveLength(previousRequests + 1))
  return http.requests[previousRequests]
}

async function respond(request: PendingIdentityRequest, value: unknown, status = 200) {
  await act(async () => {
    request.respond(value, status)
  })
}

function fillResetCredentials() {
  changeField("验证码", "123456")
  changeField("新密码", "password-for-b")
  changeField("确认新密码", "password-for-b")
}

async function advanceSeconds(seconds: number) {
  for (let elapsed = 0; elapsed < seconds; elapsed += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
  }
}

beforeEach(() => {
  mocks.params = new URLSearchParams("interactionId=interaction-1&realm=User")
  http = createDeferredIdentityHttp()
  vi.stubGlobal("fetch", http.fetch)
  vi.spyOn(identityNavigation, "assign").mockImplementation(() => undefined)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe.each(modes)("%s 当前邮箱发码", (mode) => {
  it("同批重复点击只发送一次且不会用第二次尝试覆盖等待状态或错误", async () => {
    await openFlow(mode)
    const send = button("发送验证码")
    await act(async () => {
      fireEvent.click(send)
      fireEvent.click(send)
    })

    expect(http.requests).toHaveLength(1)
    expect(screen.queryByRole("alert")).toBeNull()
    if (mode === "reset") expect(button("返回登录").disabled).toBe(true)
    await act(async () => {
      http.requests[0].respond({ type: "sent", resendAfterSeconds: 60 })
    })

    if (mode === "register") expect(button("60 秒后重发")).toBeTruthy()
    else expect(await screen.findByText("验证码已发送至 first@example.test")).toBeTruthy()
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("A 的请求退休后为 B 重新发码，后续验证码和密码只提交给 B", async () => {
    await openFlow(mode)
    const retiredRequest = await sendCode()
    expect(retiredRequest.body.email).toBe("first@example.test")
    changeField("邮箱", "second@example.test")
    await respond(retiredRequest, { type: "sent", resendAfterSeconds: 60 })

    const currentRequest = await sendCode()
    expect(currentRequest.body).toEqual({
      realm: "User",
      csrf: "csrf-marker",
      purpose: mode === "register" ? "register" : "reset_password",
      email: "second@example.test",
    })
    await respond(currentRequest, { type: "sent", resendAfterSeconds: 12 })
    await screen.findByLabelText("验证码")
    if (mode === "register") {
      changeField("验证码", "123456")
      changeField("密码", "password-for-b")
    } else {
      expect(screen.getByText("验证码已发送至 second@example.test")).toBeTruthy()
      fillResetCredentials()
    }
    const submitLabel = mode === "register" ? "创建账号" : "重设密码"
    await waitFor(() => expect(button(submitLabel).disabled).toBe(false))
    fireEvent.click(button(submitLabel))
    await waitFor(() => expect(http.requests).toHaveLength(3))

    const submission = http.requests[2]
    expect(submission.path).toBe(
      `/v1/identity/interactions/interaction-1/${mode === "register" ? "password" : "password-reset"}`,
    )
    expect(submission.body).toEqual({
      realm: "User",
      csrf: "csrf-marker",
      email: "second@example.test",
      emailCode: "123456",
      ...(mode === "register"
        ? { mode: "register", password: "password-for-b" }
        : { newPassword: "password-for-b" }),
    })
    if (mode === "register") {
      await respond(submission, {
        type: "redirect",
        redirect: "/v1/web/oidc/callback?code=synthetic-b",
      })
      expect(identityNavigation.assign).toHaveBeenCalledWith(
        "/v1/web/oidc/callback?code=synthetic-b",
      )
    } else {
      await respond(submission, { type: "password_reset" })
      expect(await screen.findByText("密码已重设，请用新密码登录")).toBeTruthy()
      expect(screen.getByRole("heading").textContent).toBe("登录 PigClaude")
      expect((screen.getByLabelText("邮箱") as HTMLInputElement).value).toBe("second@example.test")
      expect(identityNavigation.assign).not.toHaveBeenCalled()
    }
  })

  it.each(["成功", "429"] as const)("当前%s没有有效冷却秒数时回退到 60 秒", async (kind) => {
    await openFlow(mode)
    vi.useFakeTimers()
    fireEvent.click(button("发送验证码"))
    expect(http.requests).toHaveLength(1)
    if (kind === "成功") {
      await respond(http.requests[0], { type: "sent", resendAfterSeconds: 0 })
      if (mode === "reset") fireEvent.click(button("上一步"))
    } else {
      await respond(http.requests[0], { code: "EMAIL_CODE_RATE_LIMITED" }, 429)
      expect(screen.getByRole("alert").textContent).toBe("发送太频繁，请稍后重试")
    }

    expect(button("60 秒后重发").disabled).toBe(true)
    await advanceSeconds(1)
    expect(button("59 秒后重发").disabled).toBe(true)
  })

  it.each([
    ["HTTP 错误", "邮件发送失败，请稍后重试"],
    ["网络失败", "请求失败，请稍后重试"],
  ] as const)("当前%s显示后仍可用同一邮箱重试", async (kind, message) => {
    await openFlow(mode)
    const failedRequest = await sendCode()
    if (kind === "HTTP 错误") await respond(failedRequest, { code: "MAIL_SEND_FAILED" }, 503)
    else
      await act(async () => {
        failedRequest.reject(new Error("synthetic-current-network-failure"))
      })
    expect((await screen.findByRole("alert")).textContent).toBe(message)

    const retry = await sendCode()
    expect(retry.body.email).toBe("first@example.test")
    expect(retry.body.purpose).toBe(mode === "register" ? "register" : "reset_password")
    await respond(retry, { type: "sent", resendAfterSeconds: 11 })

    expect(screen.queryByRole("alert")).toBeNull()
    if (mode === "register") expect(button("11 秒后重发")).toBeTruthy()
    else expect(await screen.findByText("验证码已发送至 first@example.test")).toBeTruthy()
  })
})

describe("找回密码的当前冷却与交互隔离", () => {
  it("返回邮箱步骤后保留服务端冷却，429 等待结束后可再次发码", async () => {
    await openFlow("reset")
    vi.useFakeTimers()
    fireEvent.click(button("发送验证码"))
    await respond(http.requests[0], { type: "sent", resendAfterSeconds: 3 })
    fireEvent.click(button("上一步"))
    expect(button("3 秒后重发").disabled).toBe(true)
    await advanceSeconds(1)
    expect(button("2 秒后重发").disabled).toBe(true)
    await advanceSeconds(2)
    await vi.waitFor(() => expect(button("发送验证码").disabled).toBe(false))

    fireEvent.click(button("发送验证码"))
    await respond(
      http.requests[1],
      { code: "EMAIL_CODE_RATE_LIMITED", metadata: { retryAfterSeconds: 7 } },
      429,
    )
    expect(button("7 秒后重发").disabled).toBe(true)
    expect(screen.getByRole("alert").textContent).toBe("发送太频繁，请稍后重试")
    expect(screen.queryByLabelText("新密码")).toBeNull()
    await advanceSeconds(1)
    expect(button("6 秒后重发").disabled).toBe(true)
    await advanceSeconds(6)
    await vi.waitFor(() => expect(button("发送验证码").disabled).toBe(false))
    fireEvent.click(button("发送验证码"))
    await respond(http.requests[2], { type: "sent", resendAfterSeconds: 5 })

    expect(screen.getByText("验证码已发送至 first@example.test")).toBeTruthy()
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("换交互后旧重设完成不会污染新登录页面或它的邮箱草稿", async () => {
    const view = await openFlow("reset")
    const codeRequest = await sendCode()
    await respond(codeRequest, { type: "sent", resendAfterSeconds: 60 })
    await screen.findByLabelText("新密码")
    fillResetCredentials()
    fireEvent.click(button("重设密码"))
    await waitFor(() => expect(http.requests).toHaveLength(2))
    const oldReset = http.requests[1]
    expect(oldReset.path).toBe("/v1/identity/interactions/interaction-1/password-reset")

    mocks.params = new URLSearchParams("interactionId=interaction-2&realm=User")
    view.rerender(<InteractionPanel />)
    await screen.findByLabelText("邮箱")
    changeField("邮箱", "second@example.test")
    await respond(oldReset, { type: "password_reset" })

    expect(screen.getByRole("heading").textContent).toBe("登录 PigClaude")
    expect((screen.getByLabelText("邮箱") as HTMLInputElement).value).toBe("second@example.test")
    expect(screen.queryByText("密码已重设，请用新密码登录")).toBeNull()
    expect(screen.queryByRole("alert")).toBeNull()
    expect(identityNavigation.assign).not.toHaveBeenCalled()
  })
})
