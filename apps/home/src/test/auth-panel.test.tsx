// 负责验证登录 mutation 的缓存刷新、pending、错误和查询重试 UI。
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@pigclaude/api/client"
import { AuthPanel } from "@/components/auth/auth-panel"
import { QueryError } from "@/components/query-state"

const mocks = vi.hoisted(() => ({
  login: vi.fn(),
  register: vi.fn(),
  me: vi.fn(),
  entitlement: vi.fn(),
  push: vi.fn(),
  searchParams: new URLSearchParams(),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: vi.fn() }),
  useSearchParams: () => mocks.searchParams,
}))
vi.mock("@/lib/api", () => ({
  homeApi: {
    auth: { login: mocks.login, register: mocks.register },
    user: { me: mocks.me },
    membership: { entitlement: mocks.entitlement },
  },
}))

function renderPanel(initialMode?: "login" | "register") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <AuthPanel initialMode={initialMode} />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.searchParams = new URLSearchParams()
  mocks.login.mockResolvedValue({})
  mocks.register.mockResolvedValue({})
  mocks.me.mockResolvedValue({ id: "u-1" })
  mocks.entitlement.mockResolvedValue({ status: "active" })
})

describe("AuthPanel mutation UI", () => {
  it("lets users reveal their password without submitting", () => {
    renderPanel()
    const input = screen.getByLabelText("密码") as HTMLInputElement
    expect(input.type).toBe("password")
    fireEvent.click(screen.getByRole("button", { name: "显示密码" }))
    expect(input.type).toBe("text")
    fireEvent.click(screen.getByRole("button", { name: "隐藏密码" }))
    expect(input.type).toBe("password")
    expect(mocks.login).not.toHaveBeenCalled()
  })

  it("updates the selected panel when soft navigation changes tab", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const view = render(
      <QueryClientProvider client={client}>
        <AuthPanel />
      </QueryClientProvider>,
    )
    mocks.searchParams = new URLSearchParams("tab=register")
    view.rerender(
      <QueryClientProvider client={client}>
        <AuthPanel />
      </QueryClientProvider>,
    )
    expect(screen.getByLabelText("昵称")).toBeTruthy()
    mocks.searchParams = new URLSearchParams()
    view.rerender(
      <QueryClientProvider client={client}>
        <AuthPanel />
      </QueryClientProvider>,
    )
    expect(screen.queryByLabelText("昵称")).toBeNull()
  })

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

  it("returns to an authorize deep link after login", async () => {
    mocks.searchParams = new URLSearchParams("redirect=%2Fauthorize%2Fflow-1%3Fstate%3Dflow-state")
    renderPanel()
    fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "ada@example.com" } })
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "password" } })
    fireEvent.submit(document.querySelector("form") as HTMLFormElement)
    await waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith("/authorize/flow-1?state=flow-state"),
    )
  })

  it("returns to an authorize deep link after registration", async () => {
    mocks.searchParams = new URLSearchParams("redirect=%2Fauthorize%2Fflow-2%3Fstate%3Dflow-state")
    renderPanel("register")
    fireEvent.change(screen.getByLabelText("昵称"), { target: { value: "Ada" } })
    fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "ada@example.com" } })
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "password" } })
    fireEvent.submit(document.querySelector("form") as HTMLFormElement)
    await waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith("/authorize/flow-2?state=flow-state"),
    )
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
