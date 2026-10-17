// 负责验证本地浏览器授权夹具的一次性 code、PKCE 和授权意图传递。
import { describe, expect, it } from "vitest"
import { createAuthorizationSession } from "../main/authorization/pkce"
import { DevAuthorizationFixture } from "./authorization-fixture"

const redirectUri = "http://127.0.0.1:43123/oauth/callback"

describe("DevAuthorizationFixture", () => {
  it("issues one code and preserves register intent through the token exchange", () => {
    const session = createAuthorizationSession({
      request: { purpose: "pigclaude-login", mode: "register" },
      redirectUri,
      now: 1_000,
    })
    const fixture = new DevAuthorizationFixture({ now: () => 1_000 })
    fixture.recordSession(session)

    const approval = fixture.approve({ sessionId: session.sessionId, state: session.state })
    const callback = new URL(approval.redirectUrl)
    const token = fixture.exchange({
      code: callback.searchParams.get("code") ?? "",
      clientId: "pigclaude-desktop",
      codeVerifier: session.codeVerifier,
      redirectUri,
    })

    expect(token).toMatchObject({ purpose: "pigclaude-login", mode: "register" })
    expect(token.refreshToken).toBeTruthy()
    expect(() =>
      fixture.exchange({
        code: callback.searchParams.get("code") ?? "",
        clientId: "pigclaude-desktop",
        codeVerifier: session.codeVerifier,
        redirectUri,
      }),
    ).toThrow("授权码已消费")
  })

  it("rejects a wrong PKCE verifier and a wrong redirect URI", () => {
    const session = createAuthorizationSession({
      request: { purpose: "claude-account", mode: "authorize", accountName: "主力 Max" },
      redirectUri,
      now: 1_000,
    })
    const fixture = new DevAuthorizationFixture({ now: () => 1_000 })
    fixture.recordSession(session)
    const callback = new URL(
      fixture.approve({ sessionId: session.sessionId, state: session.state }).redirectUrl,
    )
    const input = {
      code: callback.searchParams.get("code") ?? "",
      clientId: "pigclaude-desktop",
      codeVerifier: "wrong-verifier",
      redirectUri,
    }

    expect(() => fixture.exchange(input)).toThrow("PKCE 校验失败")
    expect(() =>
      fixture.exchange({
        ...input,
        codeVerifier: session.codeVerifier,
        redirectUri: "http://127.0.0.1:1/oauth/callback",
      }),
    ).toThrow("回调地址不匹配")
  })
})
