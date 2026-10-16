// 会话环境测试。用户设置里的路由和凭据不会进入这次会话。

import { describe, expect, it } from "vitest"
import { buildSessionEnv } from "./session-env.ts"

describe("buildSessionEnv", () => {
  it("ignores routing and credential keys from the user's settings.json", () => {
    const session = buildSessionEnv({
      daemonBaseUrl: "http://127.0.0.1:47821",
      timezone: "America/Los_Angeles",
      locale: "en-US",
      userSettingsEnv: {
        ANTHROPIC_BASE_URL: "https://example.test",
        ANTHROPIC_AUTH_TOKEN: "user-token",
        ANTHROPIC_API_KEY: "user-key",
        CLAUDE_CODE_OAUTH_TOKEN: "user-oauth",
      },
    })
    expect(session.env.ANTHROPIC_BASE_URL).toBe("http://127.0.0.1:47821")
    expect(session.env.TZ).toBe("America/Los_Angeles")
    expect(session.env.LANG).toBe("en-US")
    expect(session.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(session.env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(session.env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
    expect(session.preloadSource).toContain("America/Los_Angeles")
  })
})
