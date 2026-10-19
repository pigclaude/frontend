// 负责验证成熟用户菜单的脱敏摘要、退出状态机与真实 Providers 会话清理。
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { useQueryClient, type QueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@pigclaude/api/client"
import type { MeResponse } from "@pigclaude/api/home/types"
import { Nav } from "@/components/nav"
import { Providers } from "@/components/providers"
import { AuthPanel } from "@/components/auth/auth-panel"
import { HOME_SESSION_REVALIDATE_EVENT } from "@/lib/auth-query"

const mocks = vi.hoisted(() => ({
  me: vi.fn(),
  logout: vi.fn(),
  login: vi.fn(),
  captcha: vi.fn(),
  entitlement: vi.fn(),
  replace: vi.fn(),
  push: vi.fn(),
  pathname: "/dashboard",
  capture: vi.fn(),
  params: new URLSearchParams(),
}))
vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ replace: mocks.replace, push: mocks.push }),
  useSearchParams: () => mocks.params,
}))
vi.mock("@/lib/api", () => ({
  homeApi: {
    user: { me: mocks.me },
    auth: { logout: mocks.logout, login: mocks.login, captcha: mocks.captcha },
    membership: { entitlement: mocks.entitlement },
  },
}))

const user: MeResponse = {
  id: "user-private-secret-1234",
  nickname: "Ada",
  email: "private@example.com",
  avatar: "",
  balance: "0",
  createdAt: "2026-10-01T00:00:00Z",
  productCode: "pigclaude",
  planKind: "day",
  membershipStatus: "active",
  validUntil: null,
}

function CacheProbe() {
  const client = useQueryClient()
  useEffect(() => {
    mocks.capture(client)
  }, [client])
  return null
}
function renderMenu() {
  return render(
    <Providers>
      <Nav />
      <CacheProbe />
    </Providers>,
  )
}
function currentClient(): QueryClient {
  return mocks.capture.mock.lastCall?.[0] as QueryClient
}
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  let reject: (reason: Error) => void = () => undefined
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept
    reject = fail
  })
  return { promise, resolve, reject }
}
async function openMenu() {
  const trigger = await screen.findByRole("button", { name: "用户菜单" })
  fireEvent.keyDown(trigger, { key: "Enter" })
  await screen.findByRole("menuitem", { name: "退出登录" })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.pathname = "/dashboard"
  mocks.params = new URLSearchParams()
  window.history.replaceState({}, "", "/dashboard")
  mocks.me.mockResolvedValue(user)
  mocks.logout.mockResolvedValue(undefined)
  mocks.login.mockResolvedValue(user)
  mocks.captcha.mockResolvedValue({
    enabled: false,
    provider: "turnstile",
    siteKey: null,
    mode: "disabled",
  })
  mocks.entitlement.mockResolvedValue({ status: "active" })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("home user menu lifecycle", () => {
  it("provides the source account and membership entries with masked identity", async () => {
    renderMenu()
    await openMenu()
    expect(screen.getByRole("menuitem", { name: "账户" }).getAttribute("href")).toBe("/dashboard")
    expect(screen.getByRole("menuitem", { name: "会员" }).getAttribute("href")).toBe("/membership")
    expect(screen.getByText("p•••@example.com")).toBeTruthy()
    expect(screen.getByText("user••••1234")).toBeTruthy()
    expect(screen.queryByText(user.email)).toBeNull()
    expect(screen.queryByText(user.id)).toBeNull()
    expect(screen.queryByText("账户余额")).toBeNull()
  })

  it("calls logout once, clears sensitive caches and replaces the route with plain login", async () => {
    renderMenu()
    await openMenu()
    const client = currentClient()
    client.setQueryData(["authorization", "secret-flow"], { fingerprint: "old-secret" })
    await act(async () => {
      const mutation = client.getMutationCache().build(client, {
        mutationFn: async (values: { password: string }) => values.password,
      })
      await mutation.execute({ password: "cached-password" })
    })
    fireEvent.click(screen.getByRole("menuitem", { name: "退出登录" }))
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login"))
    expect(mocks.logout).toHaveBeenCalledOnce()
    expect(client.getQueryCache().getAll()).toHaveLength(0)
    expect(client.getMutationCache().getAll()).toHaveLength(0)
    expect(screen.queryByText("Ada")).toBeNull()
    expect(mocks.push).not.toHaveBeenCalled()
    expect(mocks.me).toHaveBeenCalledOnce()
  })

  it("keeps the session and permits retry after a failed logout", async () => {
    mocks.logout.mockRejectedValueOnce(new Error("network failure"))
    renderMenu()
    await openMenu()
    const client = currentClient()
    client.setQueryData(["entitlement"], { status: "active" })
    fireEvent.click(screen.getByRole("menuitem", { name: "退出登录" }))
    expect((await screen.findByRole("alert")).textContent).toContain("退出失败，请重试")
    expect(client.getQueryData(["me"])).toEqual(user)
    expect(client.getQueryData(["entitlement"])).toEqual({ status: "active" })
    expect(mocks.replace).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("menuitem", { name: "退出登录" }))
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login"))
    expect(mocks.logout).toHaveBeenCalledTimes(2)
  })

  it("prevents repeat submission while logout is pending", async () => {
    const logout = deferred<void>()
    mocks.logout.mockReturnValueOnce(logout.promise)
    renderMenu()
    await openMenu()
    const item = screen.getByRole("menuitem", { name: "退出登录" })
    fireEvent.click(item)
    fireEvent.click(item)
    expect(mocks.logout).toHaveBeenCalledOnce()
    expect(item.getAttribute("aria-disabled")).toBe("true")
    expect(currentClient().getQueryData(["me"])).toEqual(user)
    expect(mocks.replace).not.toHaveBeenCalled()
    await act(async () => logout.resolve())
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login"))
  })

  it("does not repopulate account data from an old successful response after logout", async () => {
    renderMenu()
    await openMenu()
    const client = currentClient()
    const recovery = deferred<MeResponse>()
    mocks.me.mockReturnValueOnce(recovery.promise)
    fireEvent(window, new Event(HOME_SESSION_REVALIDATE_EVENT))
    await waitFor(() => expect(mocks.me).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByRole("menuitem", { name: "退出登录" }))
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login"))
    await act(async () => recovery.resolve(user))
    expect(client.getQueryCache().getAll()).toHaveLength(0)
    expect(screen.queryByText("Ada")).toBeNull()
    expect(mocks.replace.mock.calls).toEqual([["/login"]])
  })

  it("cancels an old recovery without competing redirects and permits a new login", async () => {
    const view = renderMenu()
    await openMenu()
    const client = currentClient()
    client.setQueryData(["authorization", "secret-flow"], { fingerprint: "old-secret" })
    const recovery = deferred<MeResponse>()
    mocks.me.mockReturnValueOnce(recovery.promise)
    fireEvent(window, new Event(HOME_SESSION_REVALIDATE_EVENT))
    await waitFor(() => expect(mocks.me).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByRole("menuitem", { name: "退出登录" }))
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login"))
    await act(async () => recovery.reject(new ApiError(401)))
    expect(mocks.replace.mock.calls).toEqual([["/login"]])
    expect(client.getQueryCache().getAll()).toHaveLength(0)

    mocks.pathname = "/login"
    window.history.replaceState({}, "", "/login")
    view.rerender(
      <Providers>
        <AuthPanel />
        <CacheProbe />
      </Providers>,
    )
    await screen.findByRole("button", { name: "继续登录" })
    expect(client.getQueryCache().getAll()).toHaveLength(0)
    expect(mocks.login).not.toHaveBeenCalled()
    const nextUser = { ...user, id: "new-user-5678", nickname: "Grace", email: "new@example.com" }
    mocks.me.mockResolvedValue(nextUser)
    expect(client.getQueryData(["authorization", "secret-flow"])).toBeUndefined()
    // 完整 RP callback 会重载页面；这里仅验证退出后的新权威读取不会复活旧缓存。
    mocks.pathname = "/dashboard"
    view.rerender(
      <Providers>
        <Nav />
        <CacheProbe />
      </Providers>,
    )
    await openMenu()
    expect(screen.getByText("Grace")).toBeTruthy()
    expect(screen.queryByText("Ada")).toBeNull()
  })
})

it("does not let old logout cleanup clear a new route or session after cancelQueries awaits", async () => {
  const view = renderMenu()
  await openMenu()
  const client = currentClient()
  const cancellation = deferred<void>()
  const cancel = vi.spyOn(client, "cancelQueries").mockReturnValueOnce(cancellation.promise)
  fireEvent.click(screen.getByRole("menuitem", { name: "退出登录" }))
  await waitFor(() => expect(cancel).toHaveBeenCalledOnce())
  expect(client.getQueryData(["me"])).toBeUndefined()
  mocks.pathname = "/login"
  window.history.replaceState({}, "", "/login")
  view.rerender(
    <Providers>
      <AuthPanel />
      <CacheProbe />
    </Providers>,
  )
  await screen.findByRole("button", { name: "继续登录" })
  client.setQueryData(["new-session"], { id: "next-user" })
  await act(async () => cancellation.resolve())
  expect(client.getQueryData(["new-session"])).toEqual({ id: "next-user" })
  expect(mocks.replace).not.toHaveBeenCalled()
})
