// 验证授权过程使用同一份账号、指纹、代理绑定和代理桥快照。

import { describe, expect, it } from "vitest"
import type { AuthorizeClaudeAccountInput } from "./account-service"
import {
  createHarness,
  createWaitingCallback,
  fingerprint,
  seedAccount,
} from "./account-service-test-fixtures"

describe("Claude 账号授权快照", () => {
  it("keeps the submitted account, proxy and fingerprint while membership is checked", async () => {
    let resume: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      resume = resolve
    })
    const harness = await createHarness({
      membershipWait: () => gate,
      profile: {
        accountUuid: "old-account",
        email: "old@example.com",
        organizationUuid: "org",
        subscriptionType: "max",
        rateLimitTier: null,
      },
    })
    await harness.store.saveAccount(seedAccount())
    const unknownArgs = ["--load-extension=/synthetic/extension"]
    const input: AuthorizeClaudeAccountInput = {
      accountId: "acc-1",
      displayName: "原始名称",
      proxyId: "p1",
      fingerprint: { ...fingerprint, unknownArgs },
    }
    const pending = harness.service.authorize(input)
    input.accountId = "another-account"
    input.displayName = "后续修改"
    input.proxyId = null
    unknownArgs.push("--no-proxy-server")
    resume()

    const account = await pending
    expect(account).toMatchObject({ id: "acc-1", displayName: "原始名称", proxyId: "p1" })
    expect(harness.launchInputs[0]?.network).toEqual({
      mode: "bound",
      bridgeUrl: "socks5://127.0.0.1:9999",
      callbackUri: "http://localhost:1234/callback",
    })
    expect(harness.launchInputs[0]?.fingerprint.unknownArgs).toEqual([
      "--load-extension=/synthetic/extension",
    ])
  })

  it("uses the same bridge address for egress validation and browser launch", async () => {
    const harness = await createHarness({ bridgeUrlAfterEgress: "socks5://127.0.0.1:9998" })
    await harness.service.authorize({ displayName: "工作账号", proxyId: "p1", fingerprint })
    expect(harness.egressCalls[0]?.bridgeUrl).toBe("socks5://127.0.0.1:9999")
    expect(harness.launchInputs[0]?.network).toEqual({
      mode: "bound",
      bridgeUrl: "socks5://127.0.0.1:9999",
      callbackUri: "http://localhost:1234/callback",
    })
  })

  it("uses one callback snapshot for authorization and the managed browser", async () => {
    let reads = 0
    const callback = {
      get redirectUri() {
        reads += 1
        return reads === 1 ? "http://localhost:1234/callback" : "http://localhost:5678/callback"
      },
      isComplete: () => true,
      waitForCode: async () => "code-1",
      cancel: () => undefined,
      close: async () => undefined,
    }
    const harness = await createHarness({ callback })
    await harness.service.authorize({ displayName: "工作账号", proxyId: "p1", fingerprint })
    expect(harness.launchInputs[0]?.network).toEqual({
      mode: "bound",
      bridgeUrl: "socks5://127.0.0.1:9999",
      callbackUri: "http://localhost:1234/callback",
    })
    expect(harness.authorizeRedirectUris).toEqual(["http://localhost:1234/callback"])
    expect(harness.exchangeRedirectUris).toEqual(["http://localhost:1234/callback"])
    expect(reads).toBe(1)
  })

  it("keeps an existing authorization cancellable when another request has conflicting arguments", async () => {
    let closed = false
    const waiting = createWaitingCallback()
    const callback = {
      ...waiting,
      close: async () => {
        if (closed) return
        closed = true
        await waiting.close()
      },
    }
    const harness = await createHarness({ callback })
    const existing = harness.service
      .authorize({ displayName: "正在授权", proxyId: null, fingerprint })
      .catch((error: unknown) => error)
    await harness.launched.promise
    await expect(
      harness.service.authorize({
        displayName: "冲突请求",
        proxyId: null,
        fingerprint: { ...fingerprint, unknownArgs: ["--profile-directory=.."] },
      }),
    ).rejects.toMatchObject({ code: "FINGERPRINT_INVALID" })
    try {
      await harness.service.cancel()
      expect(closed).toBe(true)
    } finally {
      await callback.close()
      await existing
    }
  })
})
