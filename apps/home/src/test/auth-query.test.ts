// 负责验证 home 的会话 401 分类、会话短暂不可用重试和 revalidate 事件行为。
import { homeLoginRedirect } from "../lib/auth-query"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@pigclaude/api/client"
import {
  HOME_SESSION_REVALIDATE_EVENT,
  isPublicHomePath,
  requestHomeSessionRevalidation,
  retryTransientSession,
  unauthorizedQueryAction,
  type HomeSessionRevalidationEvent,
} from "@/lib/auth-query"

describe("home auth query recovery", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/dashboard")
  })

  it("redirects only for the authoritative me query", () => {
    const unauthorized = new ApiError(401)
    expect(unauthorizedQueryAction(unauthorized, ["me"], "/dashboard")).toBe("redirect")
    expect(unauthorizedQueryAction(unauthorized, ["entitlement"], "/dashboard")).toBe("revalidate")
    expect(unauthorizedQueryAction(unauthorized, ["me"], "/login")).toBe("ignore")
    expect(unauthorizedQueryAction(unauthorized, ["me"], "/")).toBe("ignore")
    expect(unauthorizedQueryAction(unauthorized, ["me"], "/register")).toBe("ignore")
  })

  it("dispatches revalidation callbacks only on private paths", () => {
    const onValid = vi.fn()
    const onSettled = vi.fn()
    let received: HomeSessionRevalidationEvent | undefined
    window.addEventListener(
      HOME_SESSION_REVALIDATE_EVENT,
      (event) => {
        received = event as HomeSessionRevalidationEvent
      },
      { once: true },
    )
    expect(requestHomeSessionRevalidation("query-hash", onValid, onSettled)).toBe(true)
    expect(received?.queryHash).toBe("query-hash")
    expect(isPublicHomePath("/login")).toBe(true)
    expect(isPublicHomePath("/")).toBe(true)
    expect(isPublicHomePath("/register")).toBe(true)
    window.history.replaceState({}, "", "/login")
    expect(requestHomeSessionRevalidation()).toBe(false)
  })
})

// 未登录授权页的模式与 state 回跳字节由同一恢复入口保留。
it("preserves registration mode in authorization recovery", () => {
  const route = "/authorize/f/approve?mode=register&state=a%2Bb%2520"
  expect(homeLoginRedirect(route)).toBe(`/register?redirect=${encodeURIComponent(route)}`)
  expect(homeLoginRedirect(route.replace("register", "unknown"))).toBe(
    `/login?redirect=${encodeURIComponent(route.replace("register", "unknown"))}`,
  )
})

describe("retryTransientSession", () => {
  it("retries only 503 AUTH_UNAVAILABLE, at most twice", () => {
    const busy = new ApiError(503, { code: "AUTH_UNAVAILABLE" })
    expect(retryTransientSession(0, busy)).toBe(true)
    expect(retryTransientSession(1, busy)).toBe(true)
    expect(retryTransientSession(2, busy)).toBe(false)
    expect(retryTransientSession(0, new ApiError(503, { code: "PAYMENT_UNAVAILABLE" }))).toBe(false)
    expect(retryTransientSession(0, new ApiError(401))).toBe(false)
    expect(retryTransientSession(0, new Error("network"))).toBe(false)
  })
})
