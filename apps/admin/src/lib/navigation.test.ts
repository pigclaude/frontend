// 负责验证 401 recovery 的登录回跳编码和外部 redirect 防护。
import { describe, expect, it } from "vitest"
import { loginRedirectPath, safeLoginRedirect } from "./navigation"

describe("admin login recovery navigation", () => {
  it("preserves the protected page query and hash", () => {
    expect(loginRedirectPath("/membership", "?user=u1", "#devices")).toBe(
      "/login?redirect=%2Fmembership%3Fuser%3Du1%23devices",
    )
  })

  it("rejects external and missing redirect values", () => {
    expect(safeLoginRedirect("https://example.com")).toBe("/users")
    expect(safeLoginRedirect("//example.com")).toBe("/users")
    expect(safeLoginRedirect(null)).toBe("/users")
    expect(safeLoginRedirect("/audits?event=device.unbound")).toBe("/audits?event=device.unbound")
  })
})
