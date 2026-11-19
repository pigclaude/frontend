// 负责验证网站身份交互恢复和必须从原入口重新发起的过期场景。
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { InteractionPanel } from "@/components/identity/interaction-panel"
import { interaction, json } from "./identity-fixture"
const mocks = vi.hoisted(() => ({
  params: new URLSearchParams("interactionId=interaction-1&realm=User"),
  fetch: vi.fn<typeof fetch>(),
}))
vi.mock("next/navigation", () => ({ useSearchParams: () => mocks.params }))
const soon = () => Math.floor(Date.now() / 1000) + 2
const captcha = () =>
  json({ enabled: false, provider: "turnstile", siteKey: null, mode: "disabled" })
const startPath = "/v1/web/oidc/start?returnTo=%2Faccount&maxAge=0"

function expiringHomeLogin(respond: (path: string, init: RequestInit | undefined) => Response) {
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-11-19T08:00:00.000Z"))
  const expiresAt = soon()
  const restartUrl = `${window.location.origin}/login`
  mocks.fetch.mockImplementation(async (url, init) => {
    const path = String(url)
    if (path.endsWith("/auth/captcha")) return captcha()
    if (path.endsWith("/auth/mail-status")) return json({ available: true })
    if (path === "/v1/identity/interactions/interaction-1?realm=User") {
      return json(interaction({ expiresAt, providers: [], restartUrl }))
    }
    if (path === startPath) {
      return Object.defineProperties(new Response(), {
        redirected: { value: true },
        url: { value: `${window.location.origin}/identity/login?interactionId=renewed&realm=User` },
      })
    }
    if (path === "/v1/identity/interactions/renewed?realm=User") {
      return json(interaction({ interactionId: "renewed", csrf: "new-csrf", restartUrl }))
    }
    return respond(path, init)
  })
}

beforeEach(() => {
  vi.stubGlobal("fetch", mocks.fetch)
  mocks.params = new URLSearchParams("interactionId=interaction-1&realm=User")
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  mocks.fetch.mockReset()
})

it("keeps the filled registration form and submits it on a fresh interaction after expiry", async () => {
  expiringHomeLogin((path) => {
    if (path === "/v1/identity/interactions/renewed/password") {
      return json({ code: "EMAIL_CODE_INVALID" }, 400)
    }
    return json({}, 404)
  })
  render(<InteractionPanel />)
  await vi.waitFor(() => expect(screen.getByRole("button", { name: "注册" })).toBeTruthy())
  fireEvent.click(screen.getByRole("button", { name: "注册" }))
  fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "trial@example.test" } })
  fireEvent.change(screen.getByLabelText("密码"), { target: { value: "sample-password" } })
  fireEvent.change(screen.getByLabelText("验证码"), { target: { value: "123456" } })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000)
  })

  expect(screen.queryByText(/登录页面停留太久/)).toBeNull()
  expect((screen.getByLabelText("邮箱") as HTMLInputElement).value).toBe("trial@example.test")
  expect((screen.getByLabelText("密码") as HTMLInputElement).value).toBe("sample-password")
  expect((screen.getByLabelText("验证码") as HTMLInputElement).value).toBe("123456")
  expect(mocks.fetch.mock.calls.some(([url]) => url === startPath)).toBe(false)
  fireEvent.click(screen.getByRole("button", { name: "创建账号" }))
  await vi.waitFor(() => expect(screen.getByText("验证码错误或已失效，请重新获取")).toBeTruthy())
  expect(mocks.fetch).toHaveBeenCalledWith(
    startPath,
    expect.objectContaining({ mode: "same-origin", credentials: "same-origin" }),
  )
  const posts = mocks.fetch.mock.calls.filter(([, init]) => init?.method === "POST")
  expect(posts).toHaveLength(1)
  expect(posts[0][0]).toBe("/v1/identity/interactions/renewed/password")
  expect(JSON.parse(String(posts[0][1]?.body))).toEqual({
    realm: "User",
    csrf: "new-csrf",
    mode: "register",
    email: "trial@example.test",
    password: "sample-password",
    emailCode: "123456",
  })
})

it("preserves the received reset code and resets the password on the renewed interaction", async () => {
  expiringHomeLogin((path) => {
    if (path === "/v1/identity/interactions/interaction-1/email-code") {
      return json({ type: "sent", resendAfterSeconds: 60 })
    }
    if (path === "/v1/identity/interactions/renewed/password-reset") {
      return json({ type: "password_reset" })
    }
    return json({}, 404)
  })
  render(<InteractionPanel />)
  await vi.waitFor(() => expect(screen.getByRole("button", { name: "忘记密码？" })).toBeTruthy())
  fireEvent.click(screen.getByRole("button", { name: "忘记密码？" }))
  fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "trial@example.test" } })
  const send = screen.getByRole("button", { name: "发送验证码" }) as HTMLButtonElement
  await vi.waitFor(() => expect(send.disabled).toBe(false))
  fireEvent.click(send)
  await vi.waitFor(() => expect(screen.getByLabelText("验证码")).toBeTruthy())
  fireEvent.change(screen.getByLabelText("验证码"), { target: { value: "654321" } })
  fireEvent.change(screen.getByLabelText("新密码", { exact: true }), {
    target: { value: "reset-password" },
  })
  fireEvent.change(screen.getByLabelText("确认新密码"), {
    target: { value: "reset-password" },
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000)
  })
  fireEvent.click(screen.getByRole("button", { name: "重设密码" }))
  await vi.waitFor(() => expect(screen.getByText("密码已重设，请用新密码登录")).toBeTruthy())
  const resets = mocks.fetch.mock.calls.filter(([url]) => String(url).endsWith("/password-reset"))
  expect(resets).toHaveLength(1)
  expect(resets[0][0]).toBe("/v1/identity/interactions/renewed/password-reset")
  expect(JSON.parse(String(resets[0][1]?.body))).toEqual({
    realm: "User",
    csrf: "new-csrf",
    email: "trial@example.test",
    emailCode: "654321",
    newPassword: "reset-password",
  })
})

it("switches an open login page to a single restart notice when the deadline passes", async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-10-22T00:00:00.000Z"))
  mocks.fetch.mockImplementation(async (url, init) =>
    String(url).endsWith("/auth/captcha")
      ? captcha()
      : init?.method === "POST"
        ? json({ error: "invalid_request" }, 400)
        : json(
            interaction({
              realm: "Admin",
              registrationAllowed: false,
              providers: [],
              expiresAt: soon(),
              restartUrl: "https://admin.pigclaude.com/login",
            }),
          ),
  )
  render(<InteractionPanel />)
  await vi.waitFor(() =>
    expect((screen.getByRole("button", { name: "登录" }) as HTMLButtonElement).disabled).toBe(
      false,
    ),
  )
  fireEvent.submit(document.querySelector("form")!)
  await vi.waitFor(() => expect(screen.getByRole("alert").textContent).toBeTruthy())
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000)
  })
  const restart = screen.getByRole("link", { name: "重新登录" })
  expect(restart.getAttribute("href")).toBe("https://admin.pigclaude.com/login")
  expect(screen.getAllByRole("alert")).toHaveLength(1)
  expect(screen.queryByRole("button", { name: "登录" })).toBeNull()
})

it("tells desktop authorizations to restart from the client", async () => {
  mocks.fetch.mockImplementation(async () =>
    json(
      interaction({
        clientId: "pigclaude-desktop",
        phase: "device_approval",
        expiresAt: Math.floor(Date.now() / 1000) - 1,
        restartUrl: null,
        device: {
          deviceId: "pcd_x",
          platform: "macos",
          name: "Mac",
          status: "new",
          bindingEpoch: null,
        },
      }),
    ),
  )
  render(<InteractionPanel />)
  expect((await screen.findByRole("alert")).textContent).toContain("回到 PigClaude 桌面端")
  expect(screen.queryByRole("link", { name: "重新登录" })).toBeNull()
})

it("does not send an admin to the user-site login when the interaction cannot be read", async () => {
  mocks.params = new URLSearchParams("interactionId=interaction-1&realm=Admin")
  mocks.fetch.mockImplementation(async () => json({ error: "invalid_request" }, 400))
  render(<InteractionPanel />)
  await screen.findByRole("alert")
  expect(screen.queryByRole("link", { name: "返回登录" })).toBeNull()
  expect(document.body.textContent).toContain("回到管理后台重新登录")
})
