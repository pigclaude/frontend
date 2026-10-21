// 账号与代理视图映射测试。覆盖状态、代理绑定和脱敏字段。

import { describe, expect, it } from "vitest"
import type { ClaudeAccountView, ProxyView } from "@pigclaude/contracts/claude-account"
import { toPoolAccount, toPoolProxy } from "./claude-account-view"

const fingerprint = {
  seed: "123456",
  brand: "Chrome",
  platform: "macos",
  lang: "en-US",
  timezone: "America/Los_Angeles",
  canvasNoise: true,
  clientRectsNoise: true,
}

const account: ClaudeAccountView = {
  id: "acc-1",
  displayName: "工作账号",
  enabled: true,
  email: "user@example.com",
  subscriptionType: "max",
  needsReauth: false,
  credentialExpiresAt: 4_102_444_800_000,
  proxyId: "p1",
  fingerprint,
  createdAt: "2026-10-21T00:00:00.000Z",
  updatedAt: "2026-10-21T00:00:00.000Z",
}

const proxy: ProxyView = {
  id: "p1",
  name: "LA-01",
  url: "http://user:***@127.0.0.1:18080",
  lastTest: { ok: true, ip: "203.0.113.42", latencyMs: 186, testedAt: account.updatedAt },
}

describe("claude account view mapping", () => {
  it("maps an account with its bound proxy", () => {
    const mapped = toPoolAccount(account, [proxy])
    expect(mapped).toMatchObject({
      id: "acc-1",
      name: "工作账号",
      status: "已授权 · max",
      autoSwitch: true,
      proxyName: "LA-01",
      proxyExit: "203.0.113.42",
      fingerprint: "123456",
      fingerprintDetail: fingerprint,
    })
    expect(JSON.stringify(mapped)).not.toMatch(/accessToken|refreshToken/)
  })

  it("marks reauthorization accounts as not auto-switchable", () => {
    const mapped = toPoolAccount({ ...account, needsReauth: true }, [proxy])
    expect(mapped.status).toBe("需要重新授权")
    expect(mapped.autoSwitch).toBe(false)
  })

  it("maps a proxy with its test result and bound account", () => {
    const mapped = toPoolProxy(proxy, [account])
    expect(mapped).toMatchObject({
      id: "p1",
      name: "LA-01",
      exit: "203.0.113.42",
      latency: 186,
      accountId: "acc-1",
      available: true,
    })
    expect(JSON.stringify(mapped)).not.toMatch(/password/)
  })

  it("does not present an untested proxy as available", () => {
    const mapped = toPoolProxy({ ...proxy, lastTest: null }, [])
    expect(mapped.exit).toBe("待检测")
    expect(mapped.available).toBe(false)
  })
})
