// 负责确认管理员 RP 入口不绕过中央 Admin 表单验证码；中央 token 回归在 Home admin-turnstile 测试。
import { render, screen, fireEvent } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { expect, it, vi } from "vitest"
import { webOidcNavigation } from "@pigclaude/api/web-oidc"
import LoginPage from "./login"
it("sends only an explicit RP start and leaves password/captcha to the canonical Admin interaction", () => {
  const fetcher = vi.fn<typeof fetch>()
  vi.stubGlobal("fetch", fetcher)
  const assign = vi.spyOn(webOidcNavigation, "assign").mockImplementation(() => {})
  try {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    )
    expect(document.querySelector("form")).toBeNull()
    expect(document.querySelector("input[type=password]")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "继续管理员登录" }))
    expect(assign).toHaveBeenCalledWith("/admin/v1/web/oidc/start?returnTo=%2Fusers")
    expect(fetcher).not.toHaveBeenCalled()
  } finally {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  }
})
