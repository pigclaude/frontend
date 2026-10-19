// 负责阻止旧第一方Cookie与单设备私有DTO重新进入共享契约。
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

describe("single current native protocol", () => {
  it("removes legacy desktop DTOs rather than importing old credentials", () => {
    const source = readFileSync(new URL("./desktop-membership.ts", import.meta.url), "utf8")
    for (const obsolete of [
      "MembershipSessionRecord",
      "DesktopAuthorizationStartRequest",
      "DesktopAuthorizationExchangeResponse",
      "sessionCookie",
    ]) {
      expect(source).not.toContain(obsolete)
    }
    expect(source).toContain("grantedScope: string")
  })
})
