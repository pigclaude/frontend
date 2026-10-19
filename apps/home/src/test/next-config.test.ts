// 负责验证 Next 固定 Route Handler 代理与真实框架 callback 请求日志排除规则。
// @vitest-environment node
import { createRequire } from "node:module"
import { describe, expect, it, vi } from "vitest"
import nextConfig from "../../next.config"

const require = createRequire(import.meta.url)
const framework: {
  logRequests: (input: {
    request: { url: string; method: string }
    response: { statusCode: number }
    loggingConfig: unknown
    requestDurationInMs: number
  }) => void
} = require("next/dist/server/dev/log-requests.js")

describe("Home Next proxy/log boundary", () => {
  it("uses Route Handlers rather than external rewrites that replace website Host", () => {
    expect(nextConfig.rewrites).toBeUndefined()
  })

  it.each([
    "/v1/web/oidc/callback",
    "/oauth2/federation/google/callback",
    "/oauth2/federation/github/callback",
    "/oauth2/authorize",
    "/identity/login",
    "/identity/authorize",
  ])("excludes %s from real framework query logging", (path) => {
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true)
    try {
      framework.logRequests({
        request: {
          url: `${path}?code=synthetic-code-marker&state=synthetic-state-marker`,
          method: "GET",
        },
        response: { statusCode: 303 },
        loggingConfig: nextConfig.logging,
        requestDurationInMs: 1,
      })
      expect(stdout).not.toHaveBeenCalled()
    } finally {
      stdout.mockRestore()
    }
  })

  it("retains ordinary incoming path/status logs", () => {
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true)
    try {
      framework.logRequests({
        request: { url: "/dashboard", method: "GET" },
        response: { statusCode: 200 },
        loggingConfig: nextConfig.logging,
        requestDurationInMs: 1,
      })
      expect(JSON.stringify(stdout.mock.calls)).toContain("/dashboard")
    } finally {
      stdout.mockRestore()
    }
  })
})
