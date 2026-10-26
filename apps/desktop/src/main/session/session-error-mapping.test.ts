// 负责验证 daemon 错误标记到会话错误码的映射，以及未知文本仍归为 SDK_ERROR。

import { describe, expect, it } from "vitest"
import { classifyDaemonError } from "./session-error-mapping"

describe("classifyDaemonError", () => {
  it("maps the three daemon failure bodies to session error codes", () => {
    expect(classifyDaemonError('{"error":"no_available_account"}')).toBe("NO_AVAILABLE_ACCOUNT")
    expect(classifyDaemonError('{"error":"proxy_unavailable"}')).toBe("PROXY_UNAVAILABLE")
    expect(classifyDaemonError('{"error":"auth_expired"}')).toBe("AUTH_EXPIRED")
  })

  it("does not classify unrelated or partial text", () => {
    expect(classifyDaemonError("socket hang up")).toBeNull()
    expect(classifyDaemonError("unavailable")).toBeNull()
    expect(classifyDaemonError("auth failed")).toBeNull()
  })
})
