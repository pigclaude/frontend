// 验证桌面办理入口在真实网站账号对齐前不展示结算，并仅经主动操作切换网站身份。
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { ApiError } from "@pigclaude/api/client"
import RecoveryPage from "@/app/membership/recovery/page"
import { HomeSessionContext } from "@/components/home-session-context"
const target = "69f099b7-260a-4f61-a37e-3332c1380e53"
const mocks = vi.hoisted(() => ({
  me: vi.fn(),
  resolve: vi.fn(),
  logout: vi.fn(),
  completeLogout: vi.fn(),
  replace: vi.fn(),
  login: vi.fn(),
  params: "",
}))
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(mocks.params),
  useRouter: () => ({ replace: mocks.replace }),
}))
vi.mock("@pigclaude/api/web-oidc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@pigclaude/api/web-oidc")>()),
  beginWebOidcLogin: mocks.login,
}))
vi.mock("@/lib/api", () => ({
  homeApi: {
    user: { me: mocks.me },
    auth: { logout: mocks.logout },
    membership: { recoveryTarget: mocks.resolve },
  },
}))
beforeEach(() => {
  mocks.params = `target=${target}`
  mocks.me.mockResolvedValue({ id: "b", email: "b@example.test" })
  mocks.resolve.mockResolvedValue({ state: "mismatch" })
  mocks.logout.mockResolvedValue(undefined)
  mocks.completeLogout.mockResolvedValue(undefined)
})
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <HomeSessionContext.Provider value={{ completeLogout: mocks.completeLogout }}>
        <RecoveryPage />
      </HomeSessionContext.Provider>
    </QueryClientProvider>,
  )
}
it("keeps website B signed in until the user explicitly switches", async () => {
  mount()
  await screen.findByText("b@example.test")
  await screen.findByText(/请使用桌面应用中显示的账号/)
  expect(mocks.logout).not.toHaveBeenCalled()
  expect(mocks.replace).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole("button", { name: "切换网站账号" }))
  await waitFor(() =>
    expect(mocks.completeLogout).toHaveBeenCalledWith({
      switchAccountReturnTo: `/membership/recovery?target=${target}`,
    }),
  )
  expect(mocks.logout).toHaveBeenCalledWith(expect.any(Function), "b")
})
it("asks an anonymous visitor to log in without doing it automatically", async () => {
  mocks.me.mockRejectedValue(new ApiError(401, { code: "UNAUTHORIZED", message: "未登录" }))
  mount()
  await screen.findByRole("button", { name: "登录并继续" })
  expect(mocks.login).not.toHaveBeenCalled()
  expect(mocks.resolve).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole("button", { name: "登录并继续" }))
  expect(mocks.login).toHaveBeenCalledWith({
    site: "home",
    mode: "login",
    returnTo: `/membership/recovery?target=${target}`,
  })
})
it("continues only when the proof names the actual current website user", async () => {
  mocks.me.mockResolvedValue({ id: "a", email: "a@example.test" })
  mocks.resolve.mockResolvedValue({ state: "matched", currentUserId: "a", action: "renew" })
  mount()
  await waitFor(() =>
    expect(mocks.replace).toHaveBeenCalledWith(`/membership?recoveryTarget=${target}`),
  )
})
it("does not use a matched proof for a different cached account", async () => {
  mocks.resolve.mockResolvedValue({ state: "matched", currentUserId: "a", action: "renew" })
  mount()
  await screen.findByText(/网站账号已变化/)
  expect(mocks.replace).not.toHaveBeenCalled()
})
it("rejects duplicate or malformed targets instead of falling into ordinary checkout", async () => {
  mocks.params = `target=${target}&target=${target}`
  mount()
  await screen.findByText(/办理入口无效或已过期/)
  expect(mocks.resolve).not.toHaveBeenCalled()
  expect(mocks.replace).not.toHaveBeenCalled()
})
it("does not treat an unknown server result as account alignment", async () => {
  mocks.resolve.mockResolvedValue({ state: "unknown" })
  mount()
  await screen.findByText(/暂时无法核对办理账号/)
  expect(mocks.replace).not.toHaveBeenCalled()
})
