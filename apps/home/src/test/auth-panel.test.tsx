// 负责验证 RP 入口保留登录/注册意图、固定错误和已有查询重试 UI。
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AuthPanel } from "@/components/auth/auth-panel"
import { QueryError } from "@/components/query-state"
const mocks = vi.hoisted(() => ({ begin: vi.fn(), params: new URLSearchParams() }))
vi.mock("next/navigation", () => ({ useSearchParams: () => mocks.params }))
vi.mock("@pigclaude/api/web-oidc", () => ({ beginWebOidcLogin: mocks.begin }))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mocks.params = new URLSearchParams()
})
describe("Home RP login panel", () => {
  it("preserves returnTo when switching between login and registration", () => {
    const redirect = "/oauth2/authorize?state=a%2Bb%2520&device_context=x"
    mocks.params = new URLSearchParams({ redirect })
    render(<AuthPanel />)
    const href = screen.getByRole("link", { name: "创建账号" }).getAttribute("href")!
    const alternate = new URL(href, "https://home.invalid")
    expect(alternate.pathname).toBe("/register")
    expect(alternate.searchParams.get("redirect")).toBe(redirect)
  })
  it("keeps register intent and encoded return path without submitting credentials", () => {
    const redirect = "/oauth2/authorize?state=a%2Bb%2520&device_context=x"
    mocks.params = new URLSearchParams({ redirect })
    render(<AuthPanel initialMode="register" />)
    expect(mocks.begin).not.toHaveBeenCalled()
    expect(screen.queryByLabelText("密码")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "继续注册" }))
    expect(mocks.begin).toHaveBeenCalledWith({ site: "home", returnTo: redirect, mode: "register" })
  })
  it("never reflects arbitrary error query strings", () => {
    mocks.params = new URLSearchParams({ oidcError: "code=synthetic-secret" })
    render(<AuthPanel />)
    expect(screen.queryByRole("alert")).toBeNull()
    expect(document.body.textContent).not.toContain("synthetic-secret")
  })
  it("keeps explicit retry for business query errors", () => {
    const retry = vi.fn()
    render(<QueryError error={new Error("暂时失败")} onRetry={retry} />)
    fireEvent.click(screen.getByRole("button", { name: "重试" }))
    expect(retry).toHaveBeenCalledOnce()
  })
})
