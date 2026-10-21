// 负责验证 RP 入口立即发起登录/注册、仅启动一次、带错误或 10 秒内重复自动发起时不自动跳转，以及固定错误和查询重试 UI。
import { StrictMode } from "react"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@pigclaude/api/client"
import { identityErrorMessage } from "@/lib/identity-api"
import { AuthPanel } from "@/components/auth/auth-panel"
import { QueryError } from "@/components/query-state"
const mocks = vi.hoisted(() => ({ begin: vi.fn(), params: new URLSearchParams() }))
vi.mock("next/navigation", () => ({ useSearchParams: () => mocks.params }))
vi.mock("@pigclaude/api/web-oidc", () => ({ beginWebOidcLogin: mocks.begin }))
afterEach(() => {
  cleanup()
  sessionStorage.clear()
  vi.useRealTimers()
  vi.clearAllMocks()
  mocks.params = new URLSearchParams()
})
describe("Home RP login panel", () => {
  it.each(["__proto__", "constructor", "toString"])(
    "ignores prototype identity error %s",
    (code) => {
      expect(identityErrorMessage(new ApiError(400, { code }))).toBe("请求失败，请稍后重试")
    },
  )
  it.each(["__proto__", "constructor", "toString"])(
    "ignores prototype query %s without rendering or warnings",
    (value) => {
      mocks.params = new URLSearchParams({ oidcError: value })
      const warning = vi.spyOn(console, "error").mockImplementation(() => undefined)
      try {
        expect(() => render(<AuthPanel />)).not.toThrow()
        expect(screen.queryByRole("alert")).toBeNull()
        expect(document.body.textContent).not.toContain(value)
        expect(warning).not.toHaveBeenCalled()
      } finally {
        warning.mockRestore()
      }
    },
  )
  it("keeps known OIDC errors in fixed Chinese", () => {
    mocks.params = new URLSearchParams({ oidcError: "OIDC_FAILED" })
    render(<AuthPanel />)
    expect(screen.getByRole("alert").textContent).toBe("登录未完成，请重试")
  })
  it("starts login immediately with location.replace", () => {
    render(<AuthPanel />)
    expect(mocks.begin).toHaveBeenCalledWith(
      { site: "home", returnTo: "/dashboard", mode: "login" },
      { replace: true },
    )
    expect(screen.getByRole("status").textContent).toBe("正在前往登录…")
    expect(screen.queryByRole("button")).toBeNull()
  })
  it("starts registration immediately with register mode and encoded return path", () => {
    const redirect = "/oauth2/authorize?state=a%2Bb%2520&device_context=x"
    mocks.params = new URLSearchParams({ redirect })
    render(<AuthPanel initialMode="register" />)
    expect(screen.queryByLabelText("密码")).toBeNull()
    expect(mocks.begin).toHaveBeenCalledWith(
      { site: "home", returnTo: redirect, mode: "register" },
      { replace: true },
    )
  })
  it("does not auto start when an OIDC error is present", () => {
    mocks.params = new URLSearchParams({ oidcError: "OIDC_FAILED" })
    render(<AuthPanel />)
    expect(mocks.begin).not.toHaveBeenCalled()
    expect(screen.getByRole("alert").textContent).toBe("登录未完成，请重试")
    fireEvent.click(screen.getByRole("button", { name: "重新登录" }))
    expect(mocks.begin).toHaveBeenCalledTimes(1)
  })
  it("starts only once under StrictMode double effects", () => {
    render(
      <StrictMode>
        <AuthPanel />
      </StrictMode>,
    )
    expect(mocks.begin).toHaveBeenCalledTimes(1)
  })
  it("never reflects arbitrary error query strings", () => {
    mocks.params = new URLSearchParams({ oidcError: "code=synthetic-secret" })
    render(<AuthPanel />)
    expect(screen.queryByRole("alert")).toBeNull()
    expect(document.body.textContent).not.toContain("synthetic-secret")
    expect(mocks.begin).toHaveBeenCalledTimes(1)
  })
  it("tells the user to click 重新登录 after a cancelled login", () => {
    mocks.params = new URLSearchParams({ oidcError: "OIDC_ACCESS_DENIED" })
    render(<AuthPanel />)
    expect(screen.getByRole("alert").textContent).toBe("已取消登录，可点击重新登录")
    expect(screen.getByRole("button", { name: "重新登录" })).toBeTruthy()
  })
  it("holds a second auto start within 10 seconds and waits for a click", () => {
    vi.useFakeTimers({ now: 1_000_000, toFake: ["Date"] })
    render(<AuthPanel />)
    expect(mocks.begin).toHaveBeenCalledTimes(1)
    cleanup()
    vi.setSystemTime(1_009_000)
    render(<AuthPanel />)
    expect(mocks.begin).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole("alert")).toBeNull()
    expect(screen.queryByRole("status")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "重新登录" }))
    expect(mocks.begin).toHaveBeenCalledTimes(2)
  })
  it("auto starts again once 10 seconds have passed", () => {
    vi.useFakeTimers({ now: 1_000_000, toFake: ["Date"] })
    render(<AuthPanel />)
    cleanup()
    vi.setSystemTime(1_010_000)
    render(<AuthPanel />)
    expect(mocks.begin).toHaveBeenCalledTimes(2)
    expect(screen.getByRole("status").textContent).toBe("正在前往登录…")
  })
  it("does not hold the register entry", () => {
    render(<AuthPanel />)
    cleanup()
    render(<AuthPanel initialMode="register" />)
    expect(mocks.begin).toHaveBeenCalledTimes(2)
  })
  it("auto starts as before when session storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked")
    })
    render(<AuthPanel />)
    cleanup()
    render(<AuthPanel />)
    expect(mocks.begin).toHaveBeenCalledTimes(2)
    vi.mocked(Storage.prototype.getItem).mockRestore()
  })
  it("keeps explicit retry for business query errors", () => {
    const retry = vi.fn()
    render(<QueryError error={new Error("暂时失败")} onRetry={retry} />)
    fireEvent.click(screen.getByRole("button", { name: "重试" }))
    expect(retry).toHaveBeenCalledOnce()
  })
})
