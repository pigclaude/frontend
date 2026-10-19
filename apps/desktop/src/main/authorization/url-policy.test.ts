// 负责验证主进程只允许打开当前授权服务的授权入口。
import { describe, expect, it } from "vitest"
import { isAllowedAuthorizationUrl } from "./url-policy"

describe("isAllowedAuthorizationUrl", () => {
  it("accepts only the configured authorization origin and path", () => {
    expect(
      isAllowedAuthorizationUrl(
        "http://localhost:5173/oauth2/authorize?device_context=one",
        "http://localhost:5173",
      ),
    ).toBe(true)
    expect(
      isAllowedAuthorizationUrl(
        "http://localhost:5173/authorize/flow-1/approve?state=one",
        "http://localhost:5173",
      ),
    ).toBe(false)
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

it("allows only the standard native authorize entry for the first-party issuer", () => {
  expect(
    isAllowedAuthorizationUrl(
      "http://127.0.0.1:8788/oauth2/authorize?device_context=opaque",
      "http://127.0.0.1:8788",
    ),
  ).toBe(true)
  expect(
    isAllowedAuthorizationUrl(
      "http://127.0.0.1:8788/oauth2/authorize/extra",
      "http://127.0.0.1:8788",
    ),
  ).toBe(false)
})
