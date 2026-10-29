// 负责验证 home 业务查询 401 恢复只执行一次会话校验并重试全部失败查询。
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@pigclaude/api/client"
import { Providers } from "@/components/providers"

const mocks = vi.hoisted(() => ({
  me: vi.fn(),
  entitlement: vi.fn(),
  get: vi.fn(),
  replace: vi.fn(),
  pathname: "/account",
}))

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ replace: mocks.replace }),
}))
vi.mock("@/lib/api", () => ({
  homeApi: {
    user: { me: mocks.me },
    membership: { entitlement: mocks.entitlement },
    devices: { list: mocks.get },
  },
}))

function RecoveryProbe() {
  const entitlement = useQuery({
    queryKey: ["entitlement"],
    queryFn: mocks.entitlement,
  })
  const authorization = useQuery({
    queryKey: ["devices"],
    queryFn: mocks.get,
  })
  const status = `${entitlement.data?.status ?? entitlement.error?.constructor.name ?? "pending"}${
    authorization.data?.status ?? authorization.error?.constructor.name ?? "pending"
  }`
  return <output>{status}</output>
}

function FreshSessionRecoveryProbe() {
  const queryClient = useQueryClient()
  const [ready, setReady] = useState(false)
  useEffect(() => {
    queryClient.setQueryData(["me"], { id: "cached-user" })
    setReady(true)
  }, [queryClient])
  return ready ? <RecoveryProbe /> : null
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.pathname = "/account"
  window.history.replaceState({}, "", "/account")
  mocks.me.mockResolvedValue({ id: "u-1" })
  mocks.entitlement.mockRejectedValueOnce(new ApiError(401)).mockResolvedValue({ status: "active" })
  mocks.get.mockRejectedValueOnce(new ApiError(401)).mockResolvedValue({ status: "pending" })
})

describe("home provider session recovery", () => {
  it.each([
    ["/account", "/account?section=devices", "/login?redirect=%2Faccount%3Fsection%3Ddevices"],
    [
      "/authorize/old-flow/approve",
      "/authorize/old-flow/approve?mode=register&state=preserved",
      "/register?redirect=%2Fauthorize%2Fold-flow%2Fapprove%3Fmode%3Dregister%26state%3Dpreserved",
    ],
  ])(
    "an invalid old RP session at %s enters an explicit login or registration path",
    async (path, route, expected) => {
      mocks.pathname = path
      window.history.replaceState({}, "", route)
      mocks.me.mockRejectedValue(new ApiError(401))
      render(
        <Providers>
          <RecoveryProbe />
        </Providers>,
      )
      await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith(expected))
      expect(mocks.me).toHaveBeenCalledOnce()
      expect(mocks.entitlement).toHaveBeenCalledOnce()
      expect(mocks.get).toHaveBeenCalledOnce()
    },
  )

  it("shares one me request while retrying every failed business query", async () => {
    render(
      <Providers>
        <RecoveryProbe />
      </Providers>,
    )
    await waitFor(() => expect(screen.getByText("activepending")).toBeTruthy())
    expect(mocks.me).toHaveBeenCalledOnce()
    expect(mocks.replace).not.toHaveBeenCalled()
    expect(mocks.entitlement).toHaveBeenCalledTimes(2)
    expect(mocks.get).toHaveBeenCalledTimes(2)
  })

  it("forces a network me request when a fresh cache entry already exists", async () => {
    render(
      <Providers>
        <FreshSessionRecoveryProbe />
      </Providers>,
    )
    await waitFor(() => expect(screen.getByText("activepending")).toBeTruthy())
    expect(mocks.me).toHaveBeenCalledOnce()
  })

  it("preserves the state query when session recovery redirects to login", async () => {
    mocks.pathname = "/authorize/flow-1"
    window.history.replaceState({}, "", "/authorize/flow-1?state=flow-state")
    mocks.me.mockRejectedValue(new ApiError(401))
    render(
      <Providers>
        <RecoveryProbe />
      </Providers>,
    )
    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith(
        "/login?redirect=%2Fauthorize%2Fflow-1%3Fstate%3Dflow-state",
      ),
    )
  })
})

// OP 交互浏览器可以没有 Home RP Cookie，不能触发 me→登录恢复循环。
it.each(["/identity/login", "/identity/authorize"])(
  "does not recover Home session on public %s",
  async (path) => {
    mocks.pathname = path
    window.history.replaceState({}, "", path)
    render(
      <Providers>
        <RecoveryProbe />
      </Providers>,
    )
    await screen.findByText("ApiErrorApiError")
    fireEvent(window, new Event("pigclaude:home-session-revalidate"))
    await waitFor(() => expect(mocks.me).not.toHaveBeenCalled())
    expect(mocks.replace).not.toHaveBeenCalled()
  },
)
