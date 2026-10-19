// 负责验证浏览器授权会话的 PKCE、state、URL 和回调边界。
import { describe, expect, it } from "vitest"
import {
  buildAuthorizationUrl,
  createAuthorizationSession,
  validateAuthorizationCallback,
  verifyPkce,
} from "./pkce"
import type { AuthorizationRequest } from "./types"

const request: AuthorizationRequest = {
  purpose: "pigclaude-login",
  mode: "login",
}

describe("authorization protocol", () => {
  it("creates an S256 PKCE pair and verifies the challenge", () => {
    const session = createAuthorizationSession({
      request,
      redirectUri: "http://127.0.0.1:43123/oauth/callback",
      now: 1_000,
    })

    expect(session.codeVerifier).toHaveLength(64)
    expect(session.codeChallenge).not.toContain("=")
    expect(verifyPkce(session.codeVerifier, session.codeChallenge)).toBe(true)
    expect(verifyPkce("wrong-verifier", session.codeChallenge)).toBe(false)
  })

  it("builds an authorization URL without leaking the verifier", () => {
    const session = createAuthorizationSession({
      request: { ...request, mode: "register" },
      redirectUri: "http://127.0.0.1:43123/oauth/callback",
      now: 1_000,
    })
    const url = new URL(buildAuthorizationUrl(session, "http://localhost:5173"))

    expect(url.pathname).toBe("/authorize")
    expect(url.searchParams.get("session_id")).toBe(session.sessionId)
    expect(url.searchParams.get("state")).toBe(session.state)
    expect(url.searchParams.get("code_challenge")).toBe(session.codeChallenge)
    expect(url.searchParams.get("redirect_uri")).toBe(session.redirectUri)
    expect(url.searchParams.get("purpose")).toBe("pigclaude-login")
    expect(url.searchParams.get("mode")).toBe("register")
    expect(url.toString()).not.toContain(session.codeVerifier)
  })

  it("rejects an incorrect state, an empty code, and an expired session", () => {
    const session = createAuthorizationSession({
      request,
      redirectUri: "http://127.0.0.1:43123/oauth/callback",
      now: 1_000,
      ttlMs: 600_000,
    })

    expect(
      validateAuthorizationCallback(session, { code: "code", state: "wrong-state" }, 2_000),
    ).toEqual({ ok: false, reason: "state-mismatch" })
    expect(
      validateAuthorizationCallback(session, { code: "", state: session.state }, 2_000),
    ).toEqual({ ok: false, reason: "missing-code" })
    expect(
      validateAuthorizationCallback(session, { code: "code", state: session.state }, 601_001),
    ).toEqual({ ok: false, reason: "expired" })
  })
})

it("validates state before denial and never reflects a foreign error into the active flow", () => {
  const session = createAuthorizationSession({
    request,
    redirectUri: "pigclaude://authorize/callback",
    now: 1_000,
  })
  expect(
    validateAuthorizationCallback(session, { error: "access_denied", state: "foreign" }, 2_000),
  ).toEqual({ ok: false, reason: "state-mismatch" })
})
