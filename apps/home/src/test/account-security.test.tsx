// 负责验证登录与安全页：改邮箱三步与续接、错码与占用同形、改密码后退出、邮件不可用、第三方账号行与回跳提示。
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@pigclaude/api/client"
import { webOidcNavigation } from "@pigclaude/api/web-oidc"
import { Providers } from "@/components/providers"
import AccountSecurityPage from "@/app/(app)/account/security/page"
import { savePending } from "@/lib/pending-sensitive-operation"
import { accountUser, localIso } from "./account-fixtures"

const disabledCaptcha = { enabled: false, provider: "turnstile", siteKey: null, mode: "disabled" }
const mocks = vi.hoisted(() => ({
  fetch: vi.fn<typeof fetch>(),
  me: vi.fn(),
  mailStatus: vi.fn(),
  sendCode: vi.fn(),
  changeEmail: vi.fn(),
  changePassword: vi.fn(),
  replace: vi.fn(),
  toast: vi.fn(),
  params: new URLSearchParams(),
}))
vi.mock("next/navigation", () => ({
  usePathname: () => "/account/security",
  useRouter: () => ({ replace: mocks.replace, push: vi.fn() }),
  useSearchParams: () => mocks.params,
}))
vi.mock("@/lib/api", async () => {
  const { createClient } = await import("@pigclaude/api/client")
  return {
    homeClient: createClient({ fetch: mocks.fetch }),
    homeApi: {
      user: { me: mocks.me },
      auth: {
        captcha: async () => disabledCaptcha,
        mailStatus: mocks.mailStatus,
        logout: vi.fn(),
      },
      account: {
        sendCode: mocks.sendCode,
        changeEmail: mocks.changeEmail,
        changePassword: mocks.changePassword,
      },
    },
  }
})
vi.mock("sonner", () => ({ toast: { success: mocks.toast, error: mocks.toast } }))

let identities: unknown[] = []
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status })
}
function renderPage() {
  return render(
    <Providers>
      <AccountSecurityPage />
    </Providers>,
  )
}
async function enabled(name: string) {
  const button = await screen.findByRole("button", { name })
  await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false))
  return button
}

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  vi.spyOn(webOidcNavigation, "replace").mockImplementation(() => undefined)
  mocks.params = new URLSearchParams()
  identities = [
    {
      provider: "google",
      display: "lin.pig@gmail.com",
      linkedAt: localIso(2026, 10, 18),
      canUnlink: true,
    },
  ]
  mocks.me.mockResolvedValue(accountUser())
  mocks.mailStatus.mockResolvedValue({ available: true })
  mocks.sendCode.mockResolvedValue({ type: "sent", resendAfterSeconds: 60 })
  mocks.fetch.mockReset().mockImplementation(async (url) => {
    if (String(url) === "/v1/user/identities") return json(identities)
    if (String(url) === "/v1/session") return json({ csrf: "session-csrf" })
    if (String(url) === "/v1/auth/captcha") return json(disabledCaptcha)
    return json({ type: "verified" })
  })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("account security page", () => {
  it("password user changes email through recent auth → code → confirm", async () => {
    mocks.changeEmail.mockResolvedValue({ email: "new@example.com" })
    renderPage()
    const row = (await screen.findByText("lin@example.com")).closest(".set-row") as HTMLElement
    expect(within(row).getByText("已验证")).toBeTruthy()
    fireEvent.click(within(row).getByRole("button", { name: "修改邮箱" }))
    const dialog = await screen.findByRole("dialog", { name: "修改邮箱" })
    fireEvent.change(within(dialog).getByLabelText("当前密码"), { target: { value: "pw-123456" } })
    fireEvent.click(await enabled("核验并继续"))
    const reauth = await waitFor(() => {
      const call = mocks.fetch.mock.calls.find(([url]) => String(url).endsWith("/reauth"))
      expect(call).toBeTruthy()
      return call
    })
    expect(JSON.parse(String(reauth?.[1]?.body))).toMatchObject({
      method: "password",
      action: { operation: "change_email" },
    })

    fireEvent.change(await screen.findByLabelText("新邮箱"), {
      target: { value: " New@Example.com " },
    })
    fireEvent.click(await enabled("发送验证码"))
    await waitFor(() =>
      expect(mocks.sendCode).toHaveBeenCalledWith(
        { purpose: "change_email", email: "new@example.com" },
        expect.any(Function),
      ),
    )
    expect(await screen.findByText("没收到？确认邮箱地址是否正确，或换一个邮箱。")).toBeTruthy()
    expect(screen.getByRole("button", { name: "60 秒后可重发" })).toBeTruthy()
    fireEvent.change(screen.getByLabelText("验证码"), { target: { value: "123456" } })
    fireEvent.click(screen.getByRole("button", { name: "确认修改" }))
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith("邮箱已修改"))
    expect(mocks.changeEmail).toHaveBeenCalledWith(
      { email: "new@example.com", emailCode: "123456" },
      expect.any(Function),
    )
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("refuses to send a code to the current address", async () => {
    renderPage()
    fireEvent.click(await screen.findByRole("button", { name: "修改邮箱" }))
    fireEvent.click(await screen.findByRole("button", { name: "使用已有核验继续" }))
    fireEvent.change(await screen.findByLabelText("新邮箱"), {
      target: { value: "LIN@example.com" },
    })
    fireEvent.click(await enabled("发送验证码"))
    expect((await screen.findByRole("alert")).textContent).toBe("新邮箱不能和当前邮箱相同")
    expect(mocks.sendCode).not.toHaveBeenCalled()
  })

  it("social user resumes change-email at step 2 after provider verification", async () => {
    mocks.me.mockResolvedValue(accountUser({ hasPassword: false, passwordChangedAt: null }))
    identities = [{ ...(identities[0] as object), canUnlink: false }]
    savePending({ operation: "change_email" })
    mocks.params = new URLSearchParams("identityResult=verified")
    renderPage()
    const dialog = await screen.findByRole("dialog", { name: "修改邮箱" })
    expect(within(dialog).getByLabelText("新邮箱")).toBeTruthy()
    expect(mocks.replace).toHaveBeenCalledWith("/account/security")
    expect(sessionStorage.length).toBe(0)
  })

  it("social user verifies with the bound provider and remembers the operation", async () => {
    const { identityManagementNavigation } =
      await import("@/components/identity/identity-management")
    const assign = vi.spyOn(identityManagementNavigation, "assign").mockImplementation(() => {})
    mocks.me.mockResolvedValue(accountUser({ hasPassword: false, passwordChangedAt: null }))
    const original = mocks.fetch.getMockImplementation()!
    mocks.fetch.mockImplementation(async (url, init) =>
      String(url).endsWith("/reauth")
        ? json({ type: "redirect", redirect: "https://accounts.example/authorize" })
        : original(url, init),
    )
    renderPage()
    fireEvent.click(await screen.findByRole("button", { name: "修改邮箱" }))
    const dialog = await screen.findByRole("dialog", { name: "修改邮箱" })
    expect(within(dialog).queryByLabelText("当前密码")).toBeNull()
    fireEvent.click(within(dialog).getByRole("button", { name: "使用已绑定 Google 核验" }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://accounts.example/authorize"))
    expect(sessionStorage.getItem("pigclaude.pendingSensitiveOperation")).toContain("change_email")
  })

  it("wrong or taken-email code shows the same invalid message", async () => {
    mocks.changeEmail.mockRejectedValue(new ApiError(400, { code: "EMAIL_CODE_INVALID" }))
    renderPage()
    fireEvent.click(await screen.findByRole("button", { name: "修改邮箱" }))
    fireEvent.click(await screen.findByRole("button", { name: "使用已有核验继续" }))
    fireEvent.change(await screen.findByLabelText("新邮箱"), {
      target: { value: "taken@example.com" },
    })
    fireEvent.click(await enabled("发送验证码"))
    fireEvent.change(await screen.findByLabelText("验证码"), { target: { value: "000000" } })
    fireEvent.click(screen.getByRole("button", { name: "确认修改" }))
    expect((await screen.findByRole("alert")).textContent).toBe("验证码错误或已失效")
    expect(screen.getByRole("dialog", { name: "修改邮箱" })).toBeTruthy()
  })

  it("returns to verification when the proof has expired", async () => {
    mocks.sendCode.mockRejectedValue(new ApiError(403, { code: "FORBIDDEN" }))
    renderPage()
    fireEvent.click(await screen.findByRole("button", { name: "修改邮箱" }))
    fireEvent.click(await screen.findByRole("button", { name: "使用已有核验继续" }))
    fireEvent.change(await screen.findByLabelText("新邮箱"), {
      target: { value: "new@example.com" },
    })
    fireEvent.click(await enabled("发送验证码"))
    expect((await screen.findByRole("alert")).textContent).toBe("身份核验已过期，请重新核验")
    expect(screen.getByLabelText("当前密码")).toBeTruthy()
  })

  it("shows 设置密码 for social-only users and signs out after changing password", async () => {
    mocks.me.mockResolvedValue(accountUser({ hasPassword: false, passwordChangedAt: null }))
    mocks.changePassword.mockResolvedValue({ type: "password_changed" })
    renderPage()
    expect(await screen.findByText("还没有设置密码，设置后可以用邮箱和密码登录")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "设置密码" }))
    const dialog = await screen.findByRole("dialog", { name: "设置密码" })
    expect(within(dialog).getByText(/l•••@example\.com/)).toBeTruthy()
    fireEvent.click(await enabled("发送验证码"))
    await waitFor(() =>
      expect(mocks.sendCode).toHaveBeenCalledWith({ purpose: "password" }, expect.any(Function)),
    )
    fireEvent.change(await screen.findByLabelText("验证码"), { target: { value: "123456" } })
    fireEvent.change(screen.getByLabelText("新密码"), { target: { value: "short" } })
    fireEvent.change(screen.getByLabelText("确认新密码"), { target: { value: "short" } })
    fireEvent.click(screen.getByRole("button", { name: "确认设置密码" }))
    expect((await screen.findByRole("alert")).textContent).toBe("新密码需要 8～1024 个字符")
    fireEvent.change(screen.getByLabelText("新密码"), { target: { value: "long-enough-1" } })
    fireEvent.change(screen.getByLabelText("确认新密码"), { target: { value: "long-enough-2" } })
    fireEvent.click(screen.getByRole("button", { name: "确认设置密码" }))
    expect((await screen.findByRole("alert")).textContent).toBe("两次输入的密码不一致")
    expect(mocks.changePassword).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText("确认新密码"), { target: { value: "long-enough-1" } })
    fireEvent.click(screen.getByRole("button", { name: "确认设置密码" }))
    expect(await screen.findByText("密码已设置，请用新密码登录。")).toBeTruthy()
    expect(mocks.changePassword).toHaveBeenCalledWith(
      { emailCode: "123456", newPassword: "long-enough-1" },
      expect.any(Function),
    )
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login"), { timeout: 3000 })
  })

  it("shows the last change date for users with a password", async () => {
    renderPage()
    expect(await screen.findByText("上次修改：10 月 12 日")).toBeTruthy()
    expect(screen.getByRole("button", { name: "修改密码" })).toBeTruthy()
  })

  it("disables both rows when mail is unavailable", async () => {
    mocks.mailStatus.mockResolvedValue({ available: false })
    renderPage()
    await waitFor(() => expect(screen.getAllByText("邮件服务暂未开放")).toHaveLength(2))
    expect(screen.queryByRole("button", { name: "修改邮箱" })).toBeNull()
    expect(screen.queryByRole("button", { name: "修改密码" })).toBeNull()
  })

  it("renders linked accounts with display and link date, and blocks unlinking the last method", async () => {
    identities = [{ ...(identities[0] as object), canUnlink: false }]
    renderPage()
    const google = (await screen.findByText("lin.pig@gmail.com · 10 月 18 日绑定")).closest(
      ".set-row",
    ) as HTMLElement
    expect(within(google).getByText("已绑定")).toBeTruthy()
    expect(
      within(google).getByRole("button", { name: "解绑 Google" }).getAttribute("aria-disabled"),
    ).toBe("true")
    const github = screen
      .getByText("绑定后可以用 GitHub 一键登录")
      .closest(".set-row") as HTMLElement
    expect(within(github).getByText("未绑定")).toBeTruthy()
    expect(within(github).getByRole("button", { name: "绑定 GitHub" })).toBeTruthy()
  })

  it("keeps identityResult/identityError notices and ignores unknown values", async () => {
    mocks.params = new URLSearchParams("identityError=FEDERATION_UNAVAILABLE")
    const view = renderPage()
    expect((await screen.findByRole("alert")).textContent).toContain("供应商暂时不可用")
    expect(mocks.replace).toHaveBeenCalledWith("/account/security")
    view.unmount()

    mocks.params = new URLSearchParams("identityError=attacker%20text&identityResult=verified")
    renderPage()
    expect(await screen.findByText(/已完成核验，请重新选择要进行的操作/)).toBeTruthy()
    expect(screen.queryByText("attacker text")).toBeNull()
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(mocks.fetch.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(
      true,
    )
  })
})
