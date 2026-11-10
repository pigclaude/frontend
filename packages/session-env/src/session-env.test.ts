// 会话环境测试。用户设置里的路由、代理、云厂商开关和凭据不会进入这次会话。

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
    expect(session.env.LANG).toBe("en_US.UTF-8")
    expect(session.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(session.env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(session.env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
    expect(session.preloadSource).toContain("America/Los_Angeles")
  })

  it("drops proxy and Bedrock or Vertex switches while keeping the session address and locale", () => {
    const session = buildSessionEnv({
      daemonBaseUrl: "http://127.0.0.1:47821",
      timezone: "America/Los_Angeles",
      locale: "en-US",
      userSettingsEnv: {
        HTTP_PROXY: "http://proxy.example",
        HTTPS_PROXY: "http://proxy.example",
        ALL_PROXY: "socks5://proxy.example",
        http_proxy: "http://proxy.example",
        https_proxy: "http://proxy.example",
        all_proxy: "socks5://proxy.example",
        ANTHROPIC_CUSTOM_HEADERS: "X-Test: 1",
        CLAUDE_CODE_USE_BEDROCK: "1",
        CLAUDE_CODE_USE_VERTEX: "1",
        ANTHROPIC_BASE_URL: "https://example.test",
        TZ: "Europe/Paris",
        LANG: "fr-FR",
      },
    })
    expect(session.env.ANTHROPIC_BASE_URL).toBe("http://127.0.0.1:47821")
    expect(session.env.TZ).toBe("America/Los_Angeles")
    expect(session.env.LANG).toBe("en_US.UTF-8")
    expect(session.env.HTTP_PROXY).toBeUndefined()
    expect(session.env.HTTPS_PROXY).toBeUndefined()
    expect(session.env.ALL_PROXY).toBeUndefined()
    expect(session.env.http_proxy).toBeUndefined()
    expect(session.env.https_proxy).toBeUndefined()
    expect(session.env.all_proxy).toBeUndefined()
    expect(session.env.ANTHROPIC_CUSTOM_HEADERS).toBeUndefined()
    expect(session.env.CLAUDE_CODE_USE_BEDROCK).toBeUndefined()
    expect(session.env.CLAUDE_CODE_USE_VERTEX).toBeUndefined()
  })
})
