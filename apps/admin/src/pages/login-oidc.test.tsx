// 负责验证管理员 RP 入口立即以 replace 启动受信 Admin OIDC，带错误时不自动跳转，且不在本站收集凭据。
import { StrictMode } from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup } from "@testing-library/react"
import { webOidcNavigation } from "@pigclaude/api/web-oidc"
import LoginPage from "./login"
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
describe("admin RP login", () => {
  it("replaces to the RP start immediately and preserves the return target exactly once", () => {
    const replace = vi.spyOn(webOidcNavigation, "replace").mockImplementation(() => {})
    render(
      <MemoryRouter
        initialEntries={["/login?redirect=%2Fusers%3Fcursor%3Da%252Bb&provider=google"]}
      >
        <StrictMode>
          <LoginPage />
        </StrictMode>
      </MemoryRouter>,
    )
    expect(replace).toHaveBeenCalledTimes(1)
    expect(replace).toHaveBeenCalledWith(
      "/admin/v1/web/oidc/start?returnTo=%2Fusers%3Fcursor%3Da%252Bb",
    )
    expect(screen.getByRole("status").textContent).toBe("正在前往登录…")
    expect(screen.queryByRole("button", { name: "重新登录" })).toBeNull()
    expect(screen.queryByLabelText("密码")).toBeNull()
  })
  it("does not navigate with an OIDC error and retries on explicit click", () => {
    const replace = vi.spyOn(webOidcNavigation, "replace").mockImplementation(() => {})
    render(
      <MemoryRouter
        initialEntries={["/login?redirect=%2Fusers&provider=google&oidcError=OIDC_FAILED"]}
      >
        <LoginPage />
      </MemoryRouter>,
    )
    expect(replace).not.toHaveBeenCalled()
    expect(screen.queryByText(/Google|GitHub|注册/)).toBeNull()
    expect(screen.getByRole("alert").textContent).toBe("登录未完成，请重试")
    fireEvent.click(screen.getByRole("button", { name: "重新登录" }))
    expect(replace).toHaveBeenCalledWith("/admin/v1/web/oidc/start?returnTo=%2Fusers")
  })
  it("uses the line arrow icon and the 返回官网 footer link without lucide", () => {
    vi.spyOn(webOidcNavigation, "replace").mockImplementation(() => {})
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    )
    const link = screen.getByRole("link", { name: "返回官网" })
    expect(link.querySelector("svg")).not.toBeNull()
    expect(link.querySelector("svg.lucide")).toBeNull()
  })
  it.each(["__proto__", "constructor", "toString", "secret text"])(
    "does not render unknown callback error %s",
    (error) => {
      vi.spyOn(webOidcNavigation, "replace").mockImplementation(() => {})
      render(
        <MemoryRouter initialEntries={[`/login?oidcError=${encodeURIComponent(error)}`]}>
          <LoginPage />
        </MemoryRouter>,
      )
      expect(screen.queryByRole("alert")).toBeNull()
      expect(screen.queryByText(error)).toBeNull()
      expect(webOidcNavigation.replace).toHaveBeenCalledTimes(1)
    },
  )
})
