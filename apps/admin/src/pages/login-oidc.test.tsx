// 负责验证管理员 RP 入口只显式启动受信 Admin OIDC，不在本站收集凭据。
import { fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup } from "@testing-library/react"
import { webOidcNavigation } from "@pigclaude/api/web-oidc"
import LoginPage from "./login"
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
describe("admin RP login", () => {
  it("waits for explicit start and preserves the admin-local return target exactly once", () => {
    const assign = vi.spyOn(webOidcNavigation, "assign").mockImplementation(() => {})
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter
          initialEntries={[
            "/login?redirect=%2Fusers%3Fcursor%3Da%252Bb&provider=google&oidcError=OIDC_FAILED",
          ]}
        >
          <LoginPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(assign).not.toHaveBeenCalled()
    expect(screen.queryByLabelText("密码")).toBeNull()
    expect(screen.queryByText(/Google|GitHub|注册/)).toBeNull()
    expect(screen.getByRole("alert").textContent).toBe("登录未完成，请重试")
    fireEvent.click(screen.getByRole("button", { name: "继续管理员登录" }))
    expect(assign).toHaveBeenCalledWith(
      "/admin/v1/web/oidc/start?returnTo=%2Fusers%3Fcursor%3Da%252Bb",
    )
  })
  it.each(["__proto__", "constructor", "toString", "secret text"])(
    "does not render unknown callback error %s",
    (error) => {
      render(
        <MemoryRouter initialEntries={[`/login?oidcError=${encodeURIComponent(error)}`]}>
          <LoginPage />
        </MemoryRouter>,
      )
      expect(screen.queryByRole("alert")).toBeNull()
      expect(screen.queryByText(error)).toBeNull()
    },
  )
})
