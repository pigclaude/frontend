// 负责验证 home 的会话 401 分类和 revalidate 事件行为。
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@pigclaude/api"
import {
  HOME_SESSION_REVALIDATE_EVENT,
  isPublicHomePath,
  requestHomeSessionRevalidation,
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
