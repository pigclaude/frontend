// 负责验证用户详情使用列表真实快照并以原后台抽屉展示。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { MemoryRouter } from "react-router"
import UsersPage from "./users"

vi.mock("@/lib/api", () => ({
  adminApi: {
    me: vi.fn(async () => ({
      id: "a1",
      account: "reader",
      status: "active",
      permissions: ["users:read"],
    })),
    users: {
      list: vi.fn(async () => ({
        items: [
          {
            id: "42",
            nickname: "运营测试",
            email: "masked@example.test",
            status: "active",
            authVersion: "1",
            balance: "0",
            createdAt: "2026-10-18T00:00:00Z",
            lastLoginAt: null,
            avatar: "",
            githubLogin: "",
          },
        ],
        nextCursor: "0",
      })),
    },
  },
}))

describe("UsersPage", () => {
  it("opens a read-only detail drawer with the returned user", async () => {
    render(
      <MemoryRouter>
        <QueryClientProvider client={new QueryClient()}>
          <UsersPage />
        </QueryClientProvider>
      </MemoryRouter>,
    )
    fireEvent.click(await screen.findByRole("button", { name: "详情" }))
    expect(screen.getByRole("dialog", { name: "用户详情" })).toBeTruthy()
    expect(screen.getByText("从未登录")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "调账" })).toBeNull()
  })
})
