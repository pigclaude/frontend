// 负责验证 Claude 账号视图、代理视图和登录事件的运行时守卫。

import { describe, expect, it } from "vitest"
import {
  defaultClaudeFingerprint,
  isAccountSelectable,
  isClaudeAccountEvent,
  isClaudeAccountView,
  isClaudeFingerprintView,
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
    canvasNoise: "1",
    clientRectsNoise: "1",
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

  it("requires a credential, rejects a missing or empty proxy and respects cooldown", () => {
    expect(isAccountSelectable({ ...base, hasCredential: false }, now)).toBe(false)
    expect(isAccountSelectable({ ...base, proxyUrl: "" }, now)).toBe(false)
    expect(isAccountSelectable({ ...base, proxyUrl: undefined }, now)).toBe(false)
    expect(
      isAccountSelectable({ ...base, exhaustedUntil: new Date(now + 1_000).toISOString() }, now),
    ).toBe(false)
    expect(
      isAccountSelectable({ ...base, exhaustedUntil: new Date(now - 1_000).toISOString() }, now),
    ).toBe(true)
  })

  it("accepts a direct account without a proxy binding", () => {
    expect(isAccountSelectable({ ...base, proxyUrl: null }, now)).toBe(true)
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

  it("accepts a direct account view without a proxy id", () => {
    expect(isClaudeAccountView({ ...account, proxyId: null })).toBe(true)
    expect(isClaudeAccountView({ ...account, proxyId: undefined })).toBe(false)
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

describe("fingerprint contract", () => {
  const legacyFingerprint = {
    seed: "123456",
    brand: "Chrome",
    platform: "macos",
    lang: "en-US",
    timezone: "America/Los_Angeles",
    canvasNoise: "",
    clientRectsNoise: "0",
  }

  it("accepts a legacy seven-field view and an extended view", () => {
    expect(isClaudeFingerprintView(legacyFingerprint)).toBe(true)
    expect(
      isClaudeFingerprintView({
        ...legacyFingerprint,
        brandVersion: "144.0.7559.0",
        platformVersion: "15.0.0",
        acceptLang: "en-US,en",
        resolution: "1920,1080",
        customResolution: "2560,1440",
        hardwareConcurrency: "8",
        webrtcPolicy: "disable_non_proxied_udp",
        disableSpoofing: ["font", "audio", "canvas", "clientrects", "gpu"],
        colorDepth: "24",
        deviceMemory: "8",
        touchPoints: "5",
        doNotTrack: "1",
        mediaDevices: "1",
        audioNoise: "1",
        fontList: "Arial",
        webglVendor: "Google Inc.",
        webglRenderer: "ANGLE",
        unknownArgs: ["--disable-gpu"],
      }),
    ).toBe(true)
  })

  it("allows unknown keys and lets normalization drop them", () => {
    expect(isClaudeFingerprintView({ ...legacyFingerprint, futureField: true })).toBe(true)
  })

  it("rejects wrong required and optional types or enum values", () => {
    expect(isClaudeFingerprintView({ ...legacyFingerprint, seed: 123456 })).toBe(false)
    expect(isClaudeFingerprintView({ ...legacyFingerprint, canvasNoise: true })).toBe(false)
    expect(isClaudeFingerprintView({ ...legacyFingerprint, clientRectsNoise: "2" })).toBe(false)
    expect(isClaudeFingerprintView({ ...legacyFingerprint, brandVersion: 144 })).toBe(false)
    expect(isClaudeFingerprintView({ ...legacyFingerprint, webrtcPolicy: "unknown" })).toBe(false)
    expect(isClaudeFingerprintView({ ...legacyFingerprint, disableSpoofing: "font" })).toBe(false)
    expect(
      isClaudeFingerprintView({ ...legacyFingerprint, disableSpoofing: ["font", "webgl"] }),
    ).toBe(false)
    expect(isClaudeFingerprintView({ ...legacyFingerprint, unknownArgs: ["--foo", 1] })).toBe(false)
    expect(isClaudeFingerprintView({ ...legacyFingerprint, unknownArgs: "--foo" })).toBe(false)
    expect(isClaudeFingerprintView(null)).toBe(false)
  })

  it("provides AntBrowser defaults without language, timezone or seed", () => {
    expect(defaultClaudeFingerprint()).toEqual({
      seed: "",
      brand: "Chrome",
      platform: "macos",
      lang: "",
      timezone: "",
      canvasNoise: "",
      clientRectsNoise: "",
      brandVersion: "",
      platformVersion: "",
      acceptLang: "",
      resolution: "",
      customResolution: "",
      hardwareConcurrency: "",
      webrtcPolicy: "",
      disableSpoofing: [],
      colorDepth: "",
      deviceMemory: "",
      touchPoints: "",
      doNotTrack: "",
      mediaDevices: "",
      audioNoise: "",
      fontList: "",
      webglVendor: "",
      webglRenderer: "",
      unknownArgs: [],
    })
  })
})
