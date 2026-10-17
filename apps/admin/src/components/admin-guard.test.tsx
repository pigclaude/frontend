// 负责验证管理员未登录和无权限时的 redirect，避免受保护页面泄露给错误 session。
import { MemoryRouter, Route, Routes } from "react-router"
import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@pigclaude/api"
import { AdminGuard } from "@/components/admin-guard"

const state = vi.hoisted(() => ({
  result: { isPending: false, error: null as unknown, data: null as unknown },
}))
vi.mock("@/hooks/use-admin-me", () => ({ useAdminMe: () => state.result }))

function renderGuard() {
  return render(
    <MemoryRouter initialEntries={["/users"]}>
      <Routes>
        <Route path="/login" element={<span>login page</span>} />
        <Route element={<AdminGuard />}>
          <Route path="/users" element={<span>protected admin</span>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe("AdminGuard", () => {
  beforeEach(() => {
    state.result = {
      isPending: false,
      error: null,
      data: { id: "a1", account: "ops", status: "active" },
    }
  })

  it("redirects an unauthenticated session to login", async () => {
    state.result = { isPending: false, error: new ApiError(401), data: null }
    renderGuard()
    expect(await screen.findByText("login page")).toBeTruthy()
  })

  it("redirects a forbidden administrator to login", async () => {
    state.result = { isPending: false, error: new ApiError(403), data: null }
    renderGuard()
    expect(await screen.findByText("login page")).toBeTruthy()
  })

  it("renders protected content only after the server confirms the admin", () => {
    renderGuard()
    expect(screen.getByText("protected admin")).toBeTruthy()
  })
})
