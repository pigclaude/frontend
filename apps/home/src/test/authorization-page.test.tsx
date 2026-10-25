// 负责验证中央设备授权页的说明内容、切换账号、无会员提示、失效、错误重试、原始接续及重复提交门禁。
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { InteractionPanel } from "@/components/identity/interaction-panel"
import { identityNavigation } from "@/lib/identity-api"
import { interaction, json } from "./identity-fixture"
const mocks = vi.hoisted(() => ({ params: new URLSearchParams(), fetch: vi.fn<typeof fetch>() }))
vi.mock("next/navigation", () => ({ useSearchParams: () => mocks.params }))
function deviceInteraction() {
  return interaction({
    clientId: "pigclaude-desktop",
    scopes: ["user:read", "device:revoke"],
    phase: "device_approval",
    device: {
      deviceId: `pcd_${"a".repeat(64)}`,
      name: "我的 Mac",
      platform: "macos",
      status: "active",
      bindingEpoch: "9007199254740993",
    },
  })
}
beforeEach(() => {
  mocks.params = new URLSearchParams(
    "interactionId=interaction-1&realm=User&state=untrusted-query-state",
  )
  mocks.fetch.mockImplementation(async () => json(deviceInteraction()))
  vi.stubGlobal("fetch", mocks.fetch)
  vi.spyOn(identityNavigation, "assign").mockImplementation(() => undefined)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  mocks.fetch.mockReset()
})
describe("central authorization entry", () => {
  it("cannot approve a URL missing the server interaction", async () => {
    mocks.params = new URLSearchParams("state=untrusted-query-state")
    render(<InteractionPanel />)
    expect((await screen.findByRole("alert")).textContent).toContain("登录交互缺失")
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(screen.queryByRole("button", { name: "授权并打开桌面端" })).toBeNull()
  })
  it("retries a failed descriptor read without starting a new authorization", async () => {
    mocks.fetch.mockResolvedValueOnce(
      json({ error: "server_error", message: "code=synthetic-private" }, 503),
    )
    render(<InteractionPanel />)
    await screen.findByRole("alert")
    expect(document.body.textContent).not.toContain("synthetic-private")
    fireEvent.click(screen.getByRole("button", { name: "重试" }))
    await screen.findByRole("button", { name: "授权并打开桌面端" })
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
    expect(
      mocks.fetch.mock.calls.every(
        ([url]) => String(url) === "/v1/identity/interactions/interaction-1?realm=User",
      ),
    ).toBe(true)
    expect(identityNavigation.assign).not.toHaveBeenCalled()
  })
  it("consumes one explicit approval and uses only the server callback state", async () => {
    let complete: ((response: Response) => void) | undefined
    mocks.fetch.mockImplementation(async (_url, init) =>
      init?.method === "POST"
        ? new Promise<Response>((resolve) => {
            complete = resolve
          })
        : json(deviceInteraction()),
    )
    render(<InteractionPanel />)
    const approve = await screen.findByRole("button", { name: "授权并打开桌面端" })
    fireEvent.click(approve)
    fireEvent.click(approve)
    await waitFor(() =>
      expect(mocks.fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1),
    )
    const post = mocks.fetch.mock.calls.find(([, init]) => init?.method === "POST")!
    expect(JSON.parse(String(post[1]?.body))).toEqual({
      realm: "User",
      csrf: "csrf-marker",
      expectedBindingEpoch: "9007199254740993",
      reauthorize: false,
    })
    expect((approve as HTMLButtonElement).disabled).toBe(true)
    complete?.(
      json({
        type: "redirect",
        redirect: "pigclaude://authorize/callback?code=synthetic&state=a%2Bb%2520",
      }),
    )
    await waitFor(() =>
      expect(identityNavigation.assign).toHaveBeenCalledWith(
        "pigclaude://authorize/callback?code=synthetic&state=a%2Bb%2520",
      ),
    )
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
  })
  it("does not extend the original deadline or offer approval for expired context", async () => {
    mocks.fetch.mockImplementation(async () =>
      json({ ...deviceInteraction(), expiresAt: Math.floor(Date.now() / 1000) - 1 }),
    )
    render(<InteractionPanel />)
    expect((await screen.findByRole("alert")).textContent).toContain("已过期")
    expect(screen.queryByRole("button", { name: "授权并打开桌面端" })).toBeNull()
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })
})

function approvalView(status: "new" | "active" | "revoked" = "new") {
  return interaction({
    clientId: "pigclaude-desktop",
    phase: "device_approval",
    account: { email: "liuqin@example.com" },
    device: {
      deviceId: `pcd_${"b".repeat(64)}`,
      name: "liuqin 的 MacBook Pro",
      platform: "macOS",
      status,
      bindingEpoch: status === "new" ? null : "7",
    },
  })
}
function serveApproval(
  view: ReturnType<typeof approvalView>,
  switchResponse: () => Promise<Response> = async () =>
    json({ type: "require_login", interaction: interaction({ account: null }) }),
) {
  mocks.fetch.mockImplementation(async (url, init) => {
    if (String(url).endsWith("/auth/captcha"))
      return json({ enabled: false, provider: "turnstile", siteKey: null, mode: "disabled" })
    if (String(url).endsWith("/switch-account")) return switchResponse()
    if (init?.method === "POST")
      return json({ type: "redirect", redirect: "pigclaude://authorize/callback?code=c" })
    return json(view)
  })
}
const posted = () => mocks.fetch.mock.calls.filter(([, init]) => init?.method === "POST")
describe("desktop authorization page", () => {
  it("shows who is authorizing which device", async () => {
    serveApproval(approvalView())
    render(<InteractionPanel />)
    await screen.findByText("liuqin 的 MacBook Pro")
    expect(screen.getByRole("heading").textContent).toBe("授权 PigClaude 桌面端")
    expect(screen.getByText("这台设备将登录到你的账号")).toBeTruthy()
    expect(screen.getByText("liuqin")).toBeTruthy()
    expect(screen.getByText("liuqin@example.com")).toBeTruthy()
    expect(screen.getByText(/新设备/).textContent).toBe("macOS · 新设备")
    for (const text of [
      "授权后桌面端可使用你的会员",
      "不会让其他设备退出登录",
      "随时可在「设备管理」里撤销",
    ])
      expect(screen.getByText(text)).toBeTruthy()
    expect(screen.getByRole("button", { name: "授权并打开桌面端" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "取消" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "切换账号" })).toBeTruthy()
  })
  it("names the authorized device status", async () => {
    serveApproval(approvalView("active"))
    render(<InteractionPanel />)
    expect((await screen.findByText(/已授权设备/)).textContent).toBe("macOS · 已授权设备")
  })
  it("switches account back to the login form of the same interaction", async () => {
    serveApproval(approvalView())
    render(<InteractionPanel />)
    fireEvent.click(await screen.findByRole("button", { name: "切换账号" }))
    await screen.findByRole("heading", { name: "登录 PigClaude" })
    expect(screen.getByLabelText("邮箱")).toBeTruthy()
    expect(posted()).toHaveLength(1)
    expect(String(posted()[0][0])).toBe("/v1/identity/interactions/interaction-1/switch-account")
    expect(JSON.parse(String(posted()[0][1]?.body))).toEqual({ realm: "User", csrf: "csrf-marker" })
    expect(identityNavigation.assign).not.toHaveBeenCalled()
  })
  it("shares the single mutation owner between switching and approval", async () => {
    let finish: ((response: Response) => void) | undefined
    serveApproval(
      approvalView(),
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve
        }),
    )
    render(<InteractionPanel />)
    fireEvent.click(await screen.findByRole("button", { name: "切换账号" }))
    const approve = screen.getByRole("button", { name: "授权并打开桌面端" }) as HTMLButtonElement
    expect(approve.disabled).toBe(true)
    expect((screen.getByRole("button", { name: "取消" }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(approve)
    expect(posted()).toHaveLength(1)
    finish?.(json({ type: "require_login", interaction: interaction({ account: null }) }))
    await screen.findByRole("heading", { name: "登录 PigClaude" })
  })
  it("keeps the revoked-device confirmation", async () => {
    serveApproval(approvalView("revoked"))
    render(<InteractionPanel />)
    expect((await screen.findByText(/已撤销的设备/)).textContent).toBe("macOS · 已撤销的设备")
    const approve = screen.getByRole("button", { name: "重新授权设备" }) as HTMLButtonElement
    expect(approve.disabled).toBe(true)
    fireEvent.click(screen.getByRole("checkbox", { name: "我确认重新授权此设备" }))
    expect(approve.disabled).toBe(false)
    fireEvent.click(approve)
    await waitFor(() => expect(posted()).toHaveLength(1))
    expect(JSON.parse(String(posted()[0][1]?.body))).toMatchObject({ reauthorize: true })
  })
  it("cancels through the existing denial", async () => {
    serveApproval(approvalView())
    render(<InteractionPanel />)
    fireEvent.click(await screen.findByRole("button", { name: "取消" }))
    await waitFor(() => expect(posted()).toHaveLength(1))
    expect(String(posted()[0][0])).toMatch(/\/deny$/)
  })
  it("shows an error and keeps the card when switching fails", async () => {
    serveApproval(approvalView(), async () => json({ error: "invalid_request" }, 400))
    render(<InteractionPanel />)
    fireEvent.click(await screen.findByRole("button", { name: "切换账号" }))
    expect((await screen.findByRole("alert")).textContent).toBe(
      "交互已失效或不可用，请重新发起登录",
    )
    await waitFor(() =>
      expect(mocks.fetch.mock.calls.filter(([, init]) => init?.method !== "POST")).toHaveLength(2),
    )
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "授权并打开桌面端" }) as HTMLButtonElement).disabled,
      ).toBe(false),
    )
    expect(screen.getByRole("alert").textContent).toBe("交互已失效或不可用，请重新发起登录")
    expect(screen.getByText("liuqin@example.com")).toBeTruthy()
    expect(
      (screen.getByRole("button", { name: "授权并打开桌面端" }) as HTMLButtonElement).disabled,
    ).toBe(false)
    expect((screen.getByRole("button", { name: "切换账号" }) as HTMLButtonElement).disabled).toBe(
      false,
    )
  })
  it("re-reads the interaction after a failed switch and keeps the error", async () => {
    let reads = 0
    mocks.fetch.mockImplementation(async (url) => {
      if (String(url).endsWith("/auth/captcha"))
        return json({ enabled: false, provider: "turnstile", siteKey: null, mode: "disabled" })
      if (String(url).endsWith("/switch-account")) return json({ error: "server_error" }, 500)
      reads += 1
      return json(reads === 1 ? approvalView() : interaction({ account: null }))
    })
    render(<InteractionPanel />)
    fireEvent.click(await screen.findByRole("button", { name: "切换账号" }))
    await screen.findByRole("heading", { name: "登录 PigClaude" })
    expect(screen.getByRole("alert").textContent).toBe("请求失败，请稍后重试")
    expect(screen.getByLabelText("邮箱")).toBeTruthy()
    expect(reads).toBe(2)
    expect(posted()).toHaveLength(1)
  })
  it("returns to the sign-in layout after switching from a registration", async () => {
    let releaseCaptcha: () => void = () => {}
    const captchaReady = new Promise<void>((resolve) => {
      releaseCaptcha = resolve
    })
    mocks.fetch.mockImplementation(async (url) => {
      const target = String(url)
      if (target.endsWith("/auth/captcha")) {
        await captchaReady
        return json({ enabled: false, provider: "turnstile", siteKey: null, mode: "disabled" })
      }
      if (target.endsWith("/v1/auth/mail-status")) return json({ available: true })
      if (target.endsWith("/password"))
        return json({ type: "require_device_approval", interaction: approvalView() })
      if (target.endsWith("/switch-account"))
        return json({ type: "require_login", interaction: interaction({ account: null }) })
      return json(interaction({ clientId: "pigclaude-desktop" }))
    })
    render(<InteractionPanel />)
    await screen.findByLabelText("邮箱")
    fireEvent.click(screen.getByRole("button", { name: "注册" }))
    expect(screen.getByRole("heading").textContent).toBe("注册 PigClaude")
    fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "new@example.com" } })
    fireEvent.change(screen.getByLabelText("验证码"), { target: { value: "123456" } })
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "valid-password" } })
    expect((screen.getByRole("button", { name: "创建账号" }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    releaseCaptcha()
    await waitFor(() =>
      expect((screen.getByRole("button", { name: "创建账号" }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    )
    fireEvent.click(screen.getByRole("button", { name: "创建账号" }))
    fireEvent.click(await screen.findByRole("button", { name: "切换账号" }))
    await screen.findByRole("heading", { name: "登录 PigClaude" })
    expect(screen.getByRole("button", { name: "登录" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "创建账号" })).toBeNull()
  })
  it("explains a missing membership and keeps switching available", async () => {
    mocks.fetch.mockImplementation(async (url, init) => {
      if (String(url).endsWith("/approve-device"))
        return json({ error: "membership_required" }, 403)
      if (init?.method === "POST") return json({ error: "invalid_request" }, 400)
      return json(approvalView())
    })
    render(<InteractionPanel />)
    fireEvent.click(await screen.findByRole("button", { name: "授权并打开桌面端" }))
    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain(
      "这个账号还没有可用会员，开通会员后再授权，或切换到已有会员的账号",
    )
    expect(alert.textContent).not.toContain("此次操作未获授权")
    const link = screen.getByRole("link", { name: "开通会员" })
    expect(link.getAttribute("href")).toBe("/membership")
    expect((screen.getByRole("button", { name: "切换账号" }) as HTMLButtonElement).disabled).toBe(
      false,
    )
  })
  it("keeps the generic denial copy for other access errors", async () => {
    mocks.fetch.mockImplementation(async (_url, init) =>
      init?.method === "POST" ? json({ error: "access_denied" }, 403) : json(approvalView()),
    )
    render(<InteractionPanel />)
    fireEvent.click(await screen.findByRole("button", { name: "授权并打开桌面端" }))
    expect((await screen.findByRole("alert")).textContent).toBe("此次操作未获授权，请重新发起登录")
    expect(screen.queryByRole("link", { name: "开通会员" })).toBeNull()
  })
  it("still offers switching when the account view is missing", async () => {
    serveApproval({ ...approvalView(), account: null })
    render(<InteractionPanel />)
    await screen.findByText("liuqin 的 MacBook Pro")
    expect(screen.getByRole("button", { name: "切换账号" })).toBeTruthy()
  })
  it("does not offer switching on web consent", async () => {
    serveApproval(interaction({ phase: "consent", account: { email: "liuqin@example.com" } }))
    render(<InteractionPanel />)
    await screen.findByRole("button", { name: "同意" })
    expect(screen.getByText("liuqin@example.com")).toBeTruthy()
    expect(screen.getByRole("button", { name: "取消" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "切换账号" })).toBeNull()
  })
})
