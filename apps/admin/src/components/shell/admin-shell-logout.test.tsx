// 负责通过真实 AdminShell 与 HTTP facade 验证退出失败保留、重试及敏感缓存清理。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AdminShell } from "./admin-shell"

const fetcher = vi.hoisted(() => {
  const fetcher = vi.fn<typeof fetch>()
  vi.stubGlobal("fetch", fetcher)
  return fetcher
})

vi.mock("@/hooks/use-admin-me", () => ({ useAdminMe: () => ({ data: { account: "admin" } }) }))
vi.mock("@/lib/navigation", () => ({ redirectToLogin: vi.fn() }))

function renderShell() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(["private-users"], { secret: "user-data" })
  client.getMutationCache().build(
    client,
    { mutationKey: ["private-grant"] },
    {
      context: undefined,
      data: { secret: "grant-data" },
      error: null,
      failureCount: 0,
      failureReason: null,
      isPaused: false,
      status: "success",
      variables: undefined,
      submittedAt: 0,
    },
  )
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/users"]}>
        <Routes>
          <Route element={<AdminShell />}>
            <Route path="users" element={<h1>用户管理内容</h1>} />
          </Route>
          <Route path="login" element={<h1>管理员登录</h1>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return client
}

async function openAccountMenu() {
  fireEvent.keyDown(screen.getByRole("button", { name: "账号菜单" }), { key: "Enter" })
  return screen.findByRole("menuitem", { name: "退出登录" })
}

describe("AdminShell logout", () => {
  beforeEach(() => {
    fetcher.mockReset()
    localStorage.clear()
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  })

  it.each(["network", "server"])(
    "keeps private caches after %s failure and clears them on retry",
    async (failure) => {
      if (failure === "network") fetcher.mockRejectedValueOnce(new TypeError("Failed to fetch"))
      else fetcher.mockResolvedValueOnce(new Response("{}", { status: 503 }))
      fetcher.mockResolvedValueOnce(new Response(null, { status: 204 }))
      const client = renderShell()
      fireEvent.click(await openAccountMenu())
      await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
      await act(async () => {})
      expect(screen.queryByRole("heading", { name: "管理员登录" })).toBeNull()
      expect(screen.getByRole("heading", { name: "用户管理内容" })).toBeTruthy()
      expect(client.getQueryData(["private-users"])).toEqual({ secret: "user-data" })
      expect(client.getMutationCache().getAll()[0]?.state.data).toEqual({ secret: "grant-data" })
      fireEvent.click(await openAccountMenu())
      await screen.findByRole("heading", { name: "管理员登录" })
      expect(fetcher).toHaveBeenCalledTimes(2)
      expect(fetcher.mock.calls[1]?.[0]).toContain("/admin/v1/auth/logout")
      expect(client.getQueryCache().getAll()).toEqual([])
      expect(client.getMutationCache().getAll()).toEqual([])
    },
  )

  it("disables repeated logout while the request is pending", async () => {
    let complete: (value: Response) => void = () => {}
    fetcher.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve
        }),
    )
    renderShell()
    fireEvent.click(await openAccountMenu())
    const pending = await openAccountMenu()
    expect(pending.hasAttribute("data-disabled")).toBe(true)
    fireEvent.click(pending)
    expect(fetcher).toHaveBeenCalledTimes(1)
    await act(async () => complete(new Response(null, { status: 204 })))
    await screen.findByRole("heading", { name: "管理员登录" })
  })

  it("clears caches when the server explicitly confirms an expired session", async () => {
    fetcher.mockResolvedValue(new Response("{}", { status: 401 }))
    const client = renderShell()
    fireEvent.click(await openAccountMenu())
    await screen.findByRole("heading", { name: "管理员登录" })
    expect(client.getQueryCache().getAll()).toEqual([])
    expect(client.getMutationCache().getAll()).toEqual([])
  })
})
