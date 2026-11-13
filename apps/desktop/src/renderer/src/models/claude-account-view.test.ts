// 账号与代理视图映射测试。覆盖状态、代理绑定和脱敏字段。

import { describe, expect, it } from "vitest"
import type {
  ClaudeAccountView,
  ClaudeFingerprintView,
  ProxyView,
} from "@pigclaude/contracts/claude-account"
import {
  accountNetworkLabel,
  proxyDescription,
  proxyStatus,
  proxyStatusTone,
  toPoolAccount,
  toPoolProxy,
} from "./claude-account-view"

const fingerprint: ClaudeFingerprintView = {
  seed: "123456",
  brand: "Chrome",
  platform: "macos",
  lang: "en-US",
  timezone: "America/Los_Angeles",
  canvasNoise: "1",
  clientRectsNoise: "1",
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

  it("maps a direct account without a proxy and labels it as the system network", () => {
    const mapped = toPoolAccount({ ...account, proxyId: null }, [proxy])
    expect(mapped.proxyId).toBeNull()
    expect(mapped.proxyName).toBeNull()
    expect(mapped.proxyExit).toBeNull()
    expect(accountNetworkLabel(mapped)).toBe("系统网络（直连）")
  })

  it("labels a bound account with its proxy name", () => {
    expect(accountNetworkLabel(toPoolAccount(account, [proxy]))).toBe("LA-01")
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

  it("tells untested proxies apart from failed ones", () => {
    const untested = toPoolProxy({ ...proxy, lastTest: null }, [])
    expect(proxyDescription(untested)).toBe("尚未测试出口")
    expect(proxyStatus(untested)).toEqual({ tone: "idle", label: "待检测" })

    const failed = toPoolProxy(
      {
        ...proxy,
        lastTest: { ok: false, ip: null, latencyMs: 0, testedAt: "2026-10-21T00:00:00.000Z" },
      },
      [],
    )
    expect(proxyStatus(failed)).toEqual({ tone: "bad", label: "未通过测试" })
    expect(proxyDescription(failed)).toBe("未取得出口 IP · 已测试")
    expect(proxyStatusTone(failed)).toBe("error")
    expect(proxyStatusTone(untested)).toBe("idle")

    const tested = toPoolProxy(proxy, [])
    expect(proxyDescription(tested)).toBe("203.0.113.42 · 已测试")
    expect(proxyStatus(tested)).toEqual({ tone: "ok", label: "186 ms" })
  })
})
