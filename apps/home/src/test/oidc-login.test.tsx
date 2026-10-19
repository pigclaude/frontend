// 负责验证 Home 入口只经 RP start，保留返回路径且不自动重试。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { webOidcStartPath } from "@pigclaude/api/web-oidc"
import { AuthPanel } from "@/components/auth/auth-panel"
import { isPublicHomePath, unauthorizedQueryAction } from "@/lib/auth-query"
import { ApiError } from "@pigclaude/api/client"
const mocks = vi.hoisted(() => ({ begin: vi.fn(), params: new URLSearchParams() }))
vi.mock("next/navigation", () => ({
  useSearchParams: () => mocks.params,
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock("@pigclaude/api/web-oidc", async (original) => ({
  ...(await original<typeof import("@pigclaude/api/web-oidc")>()),
  beginWebOidcLogin: mocks.begin,
}))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mocks.params = new URLSearchParams()
})
describe("OIDC entry", () => {
  it("encodes the original path exactly once without a mode parameter", () => {
    const path = "/oauth2/authorize?state=a%2Bb%2520&device_context=x"
    const result = webOidcStartPath({ site: "home", returnTo: path, mode: "register" })
    expect(result.startsWith("/v1/web/oidc/start?")).toBe(true)
    const params = new URL(result, "https://home.invalid").searchParams
    expect(params.get("returnTo")).toBe(path)
    expect(params.has("mode")).toBe(false)
    expect(params.get("maxAge")).toBe("0")
    expect(
      new URL(
        webOidcStartPath({ site: "home", mode: "login" }),
        "https://home.invalid",
      ).searchParams.has("maxAge"),
    ).toBe(false)
    expect(webOidcStartPath({ site: "admin", returnTo: "/users" })).toBe(
      "/admin/v1/web/oidc/start?returnTo=%2Fusers",
    )
  })
  it("only starts authentication after an explicit click, including errors", () => {
    mocks.params = new URLSearchParams({
      oidcError: "OIDC_ACCESS_DENIED",
      redirect: "/dashboard?x=a%2Bb%2520",
    })
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AuthPanel />
      </QueryClientProvider>,
    )
    expect(mocks.begin).not.toHaveBeenCalled()
    expect(screen.getByRole("alert").textContent).toContain("取消")
    fireEvent.click(screen.getByRole("button", { name: "继续登录" }))
    expect(mocks.begin).toHaveBeenCalledWith({
      site: "home",
      returnTo: "/dashboard?x=a%2Bb%2520",
      mode: "login",
    })
    expect(screen.queryByLabelText("密码")).toBeNull()
  })
  it.each(["/identity/login", "/identity/authorize"])("keeps %s independent of Home me", (path) => {
    expect(isPublicHomePath(path)).toBe(true)
    expect(unauthorizedQueryAction(new ApiError(401), ["me"], path)).toBe("ignore")
  })
})
