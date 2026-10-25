// 负责验证中央页一步式登录/注册布局、后台纯密码页、供应商错误提示与注册直达提示。
import { StrictMode } from "react"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@pigclaude/api/client"
import {
  beginWebOidcLogin,
  consumeRegistrationHint,
  webOidcNavigation,
} from "@pigclaude/api/web-oidc"
import type { IdentityInteraction } from "@/lib/identity-api"
import { identityApi, identityErrorMessage } from "@/lib/identity-api"
import { InteractionPanel } from "@/components/identity/interaction-panel"
import { interaction, json } from "./identity-fixture"

const mocks = vi.hoisted(() => ({
  params: new URLSearchParams("interactionId=interaction-1&realm=User"),
  fetch: vi.fn<typeof fetch>(),
}))
vi.mock("next/navigation", () => ({ useSearchParams: () => mocks.params }))

function serve(overrides: Partial<IdentityInteraction> = {}) {
  mocks.fetch.mockImplementation(async (url) =>
    String(url).endsWith("captcha")
      ? json({ enabled: false, provider: "turnstile", siteKey: null, mode: "disabled" })
      : json(interaction(overrides)),
  )
}

function follows(first: Element, second: Element) {
  return Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING)
}

beforeEach(() => {
  mocks.params = new URLSearchParams("interactionId=interaction-1&realm=User")
  vi.stubGlobal("fetch", mocks.fetch)
  vi.spyOn(webOidcNavigation, "assign").mockImplementation(() => undefined)
  serve()
})
afterEach(() => {
  cleanup()
  sessionStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  mocks.fetch.mockReset()
})

describe("central one-step login page", () => {
  it("shows providers above the email form on the user login page", async () => {
    render(<InteractionPanel />)
    const email = await screen.findByLabelText("邮箱")
    expect(screen.getByRole("heading").textContent).toBe("登录 PigClaude")
    expect(screen.getByText("管理会员和桌面设备")).toBeTruthy()
    const google = screen.getByRole("button", { name: "Google" })
    expect(screen.getByRole("button", { name: "GitHub" })).toBeTruthy()
    expect(follows(google, email)).toBe(true)
    expect(screen.getByText("或使用邮箱")).toBeTruthy()
    expect(screen.getByRole("button", { name: "登录" })).toBeTruthy()
    expect(screen.getByText("还没有账号？")).toBeTruthy()
    expect(screen.getByRole("button", { name: "注册" })).toBeTruthy()
    expect(screen.queryByRole("tablist")).toBeNull()
    expect(screen.getByRole("button", { name: "忘记密码？" })).toBeTruthy()
  })

  it("switches to the register layout inside the same interaction", async () => {
    const load = vi.spyOn(identityApi, "load")
    render(<InteractionPanel />)
    await screen.findByLabelText("邮箱")
    fireEvent.click(screen.getByRole("button", { name: "注册" }))
    expect(screen.getByRole("heading").textContent).toBe("注册 PigClaude")
    expect(screen.getByRole("button", { name: "创建账号" })).toBeTruthy()
    expect(screen.getByText("已有账号？")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Google" })).toBeTruthy()
    expect((screen.getByLabelText("密码") as HTMLInputElement).autocomplete).toBe("new-password")
    fireEvent.click(screen.getByRole("button", { name: "登录" }))
    expect(screen.getByRole("heading").textContent).toBe("登录 PigClaude")
    expect(load).toHaveBeenCalledTimes(1)
  })

  it("hides the provider row and divider when no providers are enabled", async () => {
    serve({ providers: [] })
    render(<InteractionPanel />)
    expect(await screen.findByLabelText("邮箱")).toBeTruthy()
    expect(screen.queryByText("或使用邮箱")).toBeNull()
    expect(screen.queryByRole("button", { name: "Google" })).toBeNull()
    expect(screen.queryByRole("button", { name: "GitHub" })).toBeNull()
  })

  it("renders the admin realm as a plain password page", async () => {
    mocks.params = new URLSearchParams("interactionId=interaction-1&realm=Admin")
    serve({ realm: "Admin", registrationAllowed: false, providers: [] })
    render(<InteractionPanel />)
    await screen.findByLabelText("邮箱")
    expect(screen.getByRole("heading").textContent).toBe("登录管理后台")
    expect(screen.getByText("仅限运营人员使用管理员账号")).toBeTruthy()
    expect(screen.queryByText("管理后台")).toBeNull()
    expect(screen.getByRole("link", { name: "返回官网" }).getAttribute("href")).toBe("/")
    expect(screen.queryByText(/注册|Google|GitHub/)).toBeNull()
  })

  it("titles Admin consent as an authorization step, not a login page", async () => {
    mocks.params = new URLSearchParams("interactionId=interaction-1&realm=Admin")
    serve({ realm: "Admin", registrationAllowed: false, providers: [], phase: "consent" })
    render(<InteractionPanel />)
    expect((await screen.findByRole("heading")).textContent).toBe("确认登录授权")
  })

  it("keeps the form usable while showing provider errors", async () => {
    mocks.params = new URLSearchParams(
      "interactionId=interaction-1&realm=User&error=FEDERATION_REJECTED",
    )
    render(<InteractionPanel />)
    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toBe(
      identityErrorMessage(new ApiError(400, { app_error: "FEDERATION_REJECTED" })),
    )
    const email = screen.getByLabelText("邮箱") as HTMLInputElement
    expect(follows(screen.getByRole("heading"), alert)).toBe(true)
    expect(follows(alert, email)).toBe(true)
    fireEvent.change(email, { target: { value: "ada@example.com" } })
    expect(email.value).toBe("ada@example.com")
    expect(email.disabled).toBe(false)
  })
})

describe("central register hint", () => {
  it("opens User register once under StrictMode and preserves later manual selection", async () => {
    beginWebOidcLogin({ site: "home", mode: "register" })
    render(
      <StrictMode>
        <InteractionPanel />
      </StrictMode>,
    )
    await screen.findByRole("button", { name: "创建账号" })
    expect(consumeRegistrationHint()).toBe(false)
    fireEvent.click(screen.getByRole("button", { name: "登录" }))
    await screen.findByRole("button", { name: "登录" })
    expect(screen.queryByRole("button", { name: "创建账号" })).toBeNull()
  })

  it.each(["Admin", "User"] as const)(
    "ignores hint when %s descriptor disallows register",
    async (realm) => {
      beginWebOidcLogin({ site: "home", mode: "register" })
      mocks.params = new URLSearchParams(`interactionId=interaction-1&realm=${realm}`)
      serve({ realm, registrationAllowed: false })
      render(<InteractionPanel />)
      await waitFor(() =>
        expect((screen.getByRole("button", { name: "登录" }) as HTMLButtonElement).disabled).toBe(
          false,
        ),
      )
      expect(screen.queryByRole("button", { name: "注册" })).toBeNull()
      expect(consumeRegistrationHint()).toBe(true)
    },
  )
})
