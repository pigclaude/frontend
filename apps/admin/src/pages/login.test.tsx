// 负责验证登录页返回官网链接不会把用户带回后台 SPA。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { describe, expect, it, vi } from "vitest"
import LoginPage from "./login"

vi.mock("@/lib/api", () => ({
  adminApi: {
    auth: {
      captcha: async () => ({
        enabled: false,
        provider: "turnstile",
        siteKey: null,
        mode: "disabled",
      }),
    },
  },
}))

describe("LoginPage home link", () => {
  it("points to the public home origin by default", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <LoginPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(screen.getByRole("link", { name: "返回官网" }).getAttribute("href")).toBe(
      "http://127.0.0.1:3000",
    )
  })
})
