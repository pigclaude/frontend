// 负责验证登录 mutation 的缓存刷新、pending、错误和查询重试 UI。
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@pigclaude/api"
import { AuthPanel } from "@/components/auth/auth-panel"
import { QueryError } from "@/components/query-state"

const mocks = vi.hoisted(() => ({
  login: vi.fn(),
  register: vi.fn(),
  me: vi.fn(),
  entitlement: vi.fn(),
  push: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock("@/lib/api", () => ({
  homeApi: {
    auth: { login: mocks.login, register: mocks.register },
    user: { me: mocks.me },
    membership: { entitlement: mocks.entitlement },
  },
}))

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <AuthPanel />
    </QueryClientProvider>,
  )
}

afterEach(cleanup)

beforeEach(() => {
  vi.clearAllMocks()
  mocks.login.mockResolvedValue({})
  mocks.register.mockResolvedValue({})
  mocks.me.mockResolvedValue({ id: "u-1" })
  mocks.entitlement.mockResolvedValue({ status: "active" })
})

describe("AuthPanel mutation UI", () => {
  it("refreshes me and entitlement cache after login", async () => {
    renderPanel()
    fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "ada@example.com" } })
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "password" } })
    fireEvent.submit(document.querySelector("form") as HTMLFormElement)
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/dashboard"))
    expect(mocks.login).toHaveBeenCalledWith({ email: "ada@example.com", password: "password" })
    expect(mocks.me).toHaveBeenCalled()
    expect(mocks.entitlement).toHaveBeenCalled()
  })

  it("shows pending state and then an API error", async () => {
    let resolveLogin: (value: Record<string, never>) => void = () => undefined
    mocks.login.mockImplementation(
      () =>
        new Promise<Record<string, never>>((resolve) => {
          resolveLogin = resolve
        }),
    )
    renderPanel()
    fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "ada@example.com" } })
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "password" } })
    const submit = document.querySelector("form") as HTMLFormElement
    fireEvent.submit(submit)
    await waitFor(() => {
      expect(
        (document.querySelector("form button[type=submit]") as HTMLButtonElement).disabled,
      ).toBe(true)
    })
    resolveLogin({})
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/dashboard"))

    mocks.login.mockRejectedValueOnce(new ApiError(401, { message: "凭据错误" }))
    fireEvent.submit(submit)
    expect((await screen.findByRole("alert")).textContent).toContain("凭据错误")
  })

  it("keeps an explicit retry action for query errors", () => {
    const retry = vi.fn()
    render(<QueryError error={new Error("暂时失败")} onRetry={retry} />)
    fireEvent.click(screen.getByRole("button", { name: "重试" }))
    expect(retry).toHaveBeenCalledOnce()
  })
})
