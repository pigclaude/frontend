// 负责验证启动错误映射：daemon 的已知失败体和未知错误分别落到稳定会话错误码。

import { describe, expect, it } from "vitest"
import { mapStartError } from "./session-host-support"

describe("mapStartError", () => {
  it("maps daemon failure bodies to session codes", () => {
    expect(mapStartError(new Error('{"error":"no_available_account"}'), "token").code).toBe(
      "NO_AVAILABLE_ACCOUNT",
    )
    expect(mapStartError(new Error('{"error":"proxy_unavailable"}'), "token").code).toBe(
      "PROXY_UNAVAILABLE",
    )
    expect(mapStartError(new Error('{"error":"auth_expired"}'), "token").code).toBe("AUTH_EXPIRED")
  })

  it("keeps unknown errors as SDK_ERROR and redacts the session token", () => {
    const error = mapStartError(new Error("failed with token"), "token")

    expect(error.code).toBe("SDK_ERROR")
    expect(error.message).not.toContain("token")
  })
})
