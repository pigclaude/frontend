// 负责验证 Claude 账号视图、代理视图和登录事件的运行时守卫。

import { describe, expect, it } from "vitest"
import {
  isAccountSelectable,
  isClaudeAccountEvent,
  isClaudeAccountView,
  isProxyView,
  type ClaudeAccountView,
} from "./claude-account"

const account: ClaudeAccountView = {
  id: "acc-1",
  displayName: "工作账号",
  enabled: true,
  email: "user@example.com",
  subscriptionType: "max",
  needsReauth: false,
  credentialExpiresAt: 1_760_000_000_000,
  proxyId: "p1",
  fingerprint: {
    seed: "123456",
    brand: "Chrome",
    platform: "macos",
    lang: "en-US",
    timezone: "America/Los_Angeles",
    canvasNoise: true,
    clientRectsNoise: true,
  },
  createdAt: "2026-10-21T00:00:00.000Z",
  updatedAt: "2026-10-21T00:00:00.000Z",
}

describe("isAccountSelectable", () => {
  const now = Date.parse("2026-10-26T00:00:00.000Z")
  const base = {
    enabled: true,
    needsReauth: false,
    hasCredential: true,
    exhaustedUntil: null,
    proxyUrl: "http://127.0.0.1:8080",
  }

  it("accepts an enabled, authorized account with a proxy outside cooldown", () => {
    expect(isAccountSelectable(base, now)).toBe(true)
  })

  it("requires a credential, a non-empty proxy and no cooldown", () => {
    expect(isAccountSelectable({ ...base, hasCredential: false }, now)).toBe(false)
    expect(isAccountSelectable({ ...base, proxyUrl: "" }, now)).toBe(false)
    expect(isAccountSelectable({ ...base, proxyUrl: null }, now)).toBe(false)
    expect(
      isAccountSelectable({ ...base, exhaustedUntil: new Date(now + 1_000).toISOString() }, now),
    ).toBe(false)
    expect(
      isAccountSelectable({ ...base, exhaustedUntil: new Date(now - 1_000).toISOString() }, now),
    ).toBe(true)
  })

  it("rejects disabled and reauthorization accounts", () => {
    expect(isAccountSelectable({ ...base, enabled: false }, now)).toBe(false)
    expect(isAccountSelectable({ ...base, needsReauth: true }, now)).toBe(false)
  })
})

describe("claude account contracts", () => {
  it("accepts a complete account view without secret fields", () => {
    expect(isClaudeAccountView(account)).toBe(true)
    expect(JSON.stringify(account)).not.toMatch(/accessToken|refreshToken|codeVerifier/)
  })

  it("rejects an account view that carries credentials", () => {
    expect(isClaudeAccountView({ ...account, accessToken: "secret" })).toBe(false)
    expect(isClaudeAccountView({ ...account, email: undefined })).toBe(false)
  })

  it("accepts a redacted proxy view and rejects a password field", () => {
    expect(
      isProxyView({
        id: "p1",
        name: "LA-01",
        url: "http://user:***@127.0.0.1:18080",
        lastTest: { ok: true, ip: "203.0.113.42", latencyMs: 186, testedAt: account.updatedAt },
      }),
    ).toBe(true)
    expect(
      isProxyView({
        id: "p1",
        name: "LA-01",
        url: "http://127.0.0.1:18080",
        password: "secret",
        lastTest: null,
      }),
    ).toBe(false)
  })

  it("accepts only known phases and error codes in login events", () => {
    expect(
      isClaudeAccountEvent({
        accountId: "acc-1",
        phase: "blocked",
        errorCode: "EGRESS_MISMATCH",
        message: "请勿登录",
      }),
    ).toBe(true)
    expect(
      isClaudeAccountEvent({
        accountId: "acc-1",
        phase: "unknown",
        errorCode: null,
        message: null,
      }),
    ).toBe(false)
    expect(
      isClaudeAccountEvent({
        accountId: "acc-1",
        phase: "failed",
        errorCode: "NOT_A_CODE",
        message: null,
      }),
    ).toBe(false)
  })
})
