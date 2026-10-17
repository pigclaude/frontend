// 负责验证主进程只允许打开当前授权服务的授权入口。
import { describe, expect, it } from "vitest"
import { isAllowedAuthorizationUrl } from "./url-policy"

describe("isAllowedAuthorizationUrl", () => {
  it("accepts only the configured authorization origin and path", () => {
    expect(
      isAllowedAuthorizationUrl(
        "http://localhost:5173/authorize?session_id=one",
        "http://localhost:5173",
      ),
    ).toBe(true)
    expect(isAllowedAuthorizationUrl("http://localhost:5173/other", "http://localhost:5173")).toBe(
      false,
    )
    expect(
      isAllowedAuthorizationUrl("https://evil.example/authorize", "http://localhost:5173"),
    ).toBe(false)
    expect(
      isAllowedAuthorizationUrl("http://localhost:5174/authorize", "http://localhost:5173"),
    ).toBe(false)
  })
})
