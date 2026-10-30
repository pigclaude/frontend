// 账号服务测试。覆盖添加、直连授权、出口阻断、账号不一致、取消、删除失败、更新和会员门禁。

import { describe, expect, it } from "vitest"
import { BrowserLaunchError } from "./fingerprint-chromium"
import { ClaudeAccountError } from "./errors"
import type { OAuthCallbackServer } from "./subscription-oauth"
import { createHarness, fingerprint, seedAccount } from "./account-service-test-fixtures"

describe("ClaudeAccountService", () => {
  it("adds an account only after egress, browser authorization and storage succeed", async () => {
    const harness = await createHarness()
    const view = await harness.service.authorize({
      displayName: "工作账号",
      proxyId: "p1",
      fingerprint,
    })
    expect(view).toMatchObject({
      id: "acc-1",
      displayName: "工作账号",
      email: "user@example.com",
      subscriptionType: "max",
      needsReauth: false,
      proxyId: "p1",
    })
    expect(harness.browserCalls).toEqual(["ensure", "launch", "stop"])
    expect(harness.bridgeCalls).toEqual([{ upstreamProxyUrl: "http://127.0.0.1:1" }])
    expect(harness.egressCalls).toEqual([
      {
        bridgeUrl: "http://127.0.0.1:9999",
        upstreamProxyUrl: "http://127.0.0.1:1",
        checkUrl: "https://egress.test/trace",
      },
    ])
    expect(harness.launchInputs[0]?.network).toEqual({
      mode: "bound",
      bridgeUrl: "http://127.0.0.1:9999",
      callbackUri: "http://localhost:1234/callback",
    })
    expect(harness.exchangeDispatchers[0]).toBeDefined()
    expect(harness.profileDispatchers[0]).toBeDefined()
    expect(harness.bridgeClosed()).toBe(true)
    expect(harness.events.map((event) => event.phase)).toEqual([
      "preparing",
      "checking-egress",
      "waiting-browser",
      "exchanging",
      "saving",
      "authorized",
    ])
    expect((await harness.store.getAccount("acc-1"))?.credential?.accessToken).toBe("access")
  })

  it("authorizes without a proxy and skips the bridge and egress check", async () => {
    const harness = await createHarness()
    await harness.store.removeProxy("p1")
    const view = await harness.service.authorize({
      displayName: "直连账号",
      proxyId: null,
      fingerprint,
    })
    expect(view.proxyId).toBeNull()
    expect(harness.browserCalls).toEqual(["ensure", "launch", "stop"])
    expect(harness.bridgeCalls).toEqual([])
    expect(harness.egressCalls).toEqual([])
    expect(harness.launchInputs).toHaveLength(1)
    expect(harness.launchInputs[0]?.network).toEqual({ mode: "system" })
    expect(harness.exchangeDispatchers).toEqual([undefined])
    expect(harness.profileDispatchers).toEqual([undefined])
    expect(harness.events.map((event) => event.phase)).toEqual([
      "preparing",
      "waiting-browser",
      "exchanging",
      "saving",
      "authorized",
    ])
    expect((await harness.store.getAccount("acc-1"))?.proxyId).toBeNull()
  })

  it("rejects a non-null proxy that does not exist", async () => {
    const harness = await createHarness()
    await expect(
      harness.service.authorize({ displayName: "工作账号", proxyId: "missing", fingerprint }),
    ).rejects.toMatchObject({ code: "PROXY_INVALID" })
    expect(harness.browserCalls).toEqual([])
    expect(harness.bridgeCalls).toEqual([])
  })

  it("blocks bound authorization before bridge or callback when protection cannot be proved", async () => {
    const harness = await createHarness({ proxyProtectionUnavailable: true })
    const existing = seedAccount()
    await harness.store.saveAccount(existing)
    const before = await harness.store.getAccount(existing.id)
    await expect(
      harness.service.authorize({
        accountId: existing.id,
        displayName: existing.displayName,
        proxyId: existing.proxyId,
        fingerprint: { ...existing.fingerprint, unknownArgs: ["--load-extension=/synthetic"] },
      }),
    ).rejects.toMatchObject({
      code: "BROWSER_START_FAILED",
      message: expect.stringContaining("受管代理保护"),
    })
    expect(harness.bridgeCalls).toEqual([])
    expect(harness.egressCalls).toEqual([])
    expect(harness.callbackCalls).toEqual([])
    expect(harness.browserCalls).toEqual([])
    expect(harness.events.at(-1)?.message).not.toContain("/synthetic")
    expect(await harness.store.getAccount(existing.id)).toEqual(before)
  })

  it("rejects a conflicting profile argument before opening the bridge and preserves the account", async () => {
    const harness = await createHarness()
    const raw = "--user-data-dir=/private/fixture-token"
    const existing = { ...seedAccount(), fingerprint: { ...fingerprint, unknownArgs: [raw] } }
    await harness.store.saveAccount(existing)
    const before = await harness.store.getAccount(existing.id)
    await expect(
      harness.service.authorize({
        accountId: existing.id,
        displayName: existing.displayName,
        proxyId: existing.proxyId,
        fingerprint: existing.fingerprint,
      }),
    ).rejects.toMatchObject({
      code: "FINGERPRINT_INVALID",
      message: expect.stringContaining("--user-data-dir"),
    })
    expect(harness.bridgeCalls).toEqual([])
    expect(harness.egressCalls).toEqual([])
    expect(harness.browserCalls).toEqual([])
    expect(harness.events.at(-1)?.message).not.toContain("fixture-token")
    expect(await harness.store.getAccount(existing.id)).toEqual(before)
    const renamed = await harness.service.update({ accountId: existing.id, displayName: "改名" })
    expect(renamed.fingerprint.unknownArgs).toEqual([raw])
    const corrected = await harness.service.update({
      accountId: existing.id,
      fingerprint: { ...existing.fingerprint, unknownArgs: [] },
    })
    expect(corrected.fingerprint.unknownArgs).toEqual([])
  })

  it("rejects host mapping for a bound proxy but keeps it for system networking", async () => {
    const unknownArgs = ["--host-resolver-rules=MAP * 127.0.0.1"]
    const bound = await createHarness()
    await expect(
      bound.service.authorize({
        displayName: "绑定代理",
        proxyId: "p1",
        fingerprint: { ...fingerprint, unknownArgs },
      }),
    ).rejects.toMatchObject({
      code: "FINGERPRINT_INVALID",
      message: expect.stringContaining("--host-resolver-rules"),
    })
    expect(bound.bridgeCalls).toEqual([])

    const system = await createHarness()
    await system.service.authorize({
      displayName: "系统网络",
      proxyId: null,
      fingerprint: { ...fingerprint, unknownArgs },
    })
    expect(system.launchInputs[0]?.fingerprint.unknownArgs).toEqual(unknownArgs)
  })

  it("blocks the authorization when the bridge and daemon exits differ", async () => {
    const harness = await createHarness({
      egress: { ok: false, reason: "mismatch", message: "请勿登录" },
    })
    await expect(
      harness.service.authorize({ displayName: "工作账号", proxyId: "p1", fingerprint }),
    ).rejects.toMatchObject({ code: "EGRESS_MISMATCH" })
    expect(harness.browserCalls).toEqual(["ensure"])
    expect(harness.events.at(-1)).toMatchObject({
      phase: "blocked",
      errorCode: "EGRESS_MISMATCH",
      message: "请勿登录",
    })
    expect(await harness.store.listAccounts()).toEqual([])
    expect(harness.bridgeClosed()).toBe(true)
  })

  it("rejects an invalid bound bridge before egress or browser launch", async () => {
    const harness = await createHarness({ bridgeUrl: "http://127.0.0.1:0" })
    await expect(
      harness.service.authorize({ displayName: "工作账号", proxyId: "p1", fingerprint }),
    ).rejects.toMatchObject({ code: "PROXY_UNAVAILABLE" })
    expect(harness.egressCalls).toEqual([])
    expect(harness.browserCalls).toEqual(["ensure"])
    expect(harness.bridgeClosed()).toBe(true)
    expect(await harness.store.listAccounts()).toEqual([])
  })

  it("rejects a missing bound bridge without falling back to system networking", async () => {
    const harness = await createHarness({ bridgeMissing: true })
    await expect(
      harness.service.authorize({ displayName: "工作账号", proxyId: "p1", fingerprint }),
    ).rejects.toMatchObject({ code: "PROXY_UNAVAILABLE" })
    expect(harness.egressCalls).toEqual([])
    expect(harness.browserCalls).toEqual(["ensure"])
    expect(await harness.store.listAccounts()).toEqual([])
  })

  it("refuses to replace an account with a different Claude account", async () => {
    const harness = await createHarness({
      profile: {
        accountUuid: "new-account",
        email: "new@example.com",
        organizationUuid: null,
        subscriptionType: null,
        rateLimitTier: null,
      },
    })
    await harness.store.saveAccount(seedAccount())
    await expect(
      harness.service.authorize({
        accountId: "acc-1",
        displayName: "工作账号",
        proxyId: "p1",
        fingerprint,
      }),
    ).rejects.toMatchObject({ code: "ACCOUNT_MISMATCH" })
    expect((await harness.store.getAccount("acc-1"))?.credential?.accessToken).toBe("old-access")
    expect(harness.browserCalls).toContain("launch")
  })

  it("cancels a pending authorization and stops the browser instance", async () => {
    let rejectWait: ((error: Error) => void) | null = null
    let cancelled = false
    const callback: OAuthCallbackServer = {
      redirectUri: "http://localhost:1234/callback",
      waitForCode: () => {
        if (cancelled) {
          return Promise.reject(new ClaudeAccountError("AUTHORIZATION_CANCELLED", "取消"))
        }
        return new Promise<string>((_resolve, reject) => {
          rejectWait = reject
        })
      },
      close: async () => {
        cancelled = true
        rejectWait?.(new ClaudeAccountError("AUTHORIZATION_CANCELLED", "取消"))
      },
    }
    const harness = await createHarness({ callback })
    const pending = harness.service.authorize({
      displayName: "工作账号",
      proxyId: "p1",
      fingerprint,
    })
    const assertion = expect(pending).rejects.toMatchObject({
      code: "AUTHORIZATION_CANCELLED",
    })
    await harness.launched.promise
    await harness.service.cancel()
    await assertion
    expect(harness.browserCalls).toContain("stop")
  })

  it("removes the local account and browser profile together", async () => {
    const harness = await createHarness()
    await harness.store.saveAccount(seedAccount())
    await harness.service.remove("acc-1")
    expect(harness.browserCalls).toEqual(["delete"])
    expect(await harness.store.getAccount("acc-1")).toBeNull()
  })

  it("keeps the local account when the browser profile cannot be deleted", async () => {
    const harness = await createHarness({
      deleteError: new BrowserLaunchError("BROWSER_PROFILE_DELETE_FAILED", "删除失败"),
    })
    await harness.store.saveAccount(seedAccount())
    await expect(harness.service.remove("acc-1")).rejects.toMatchObject({
      code: "BROWSER_PROFILE_DELETE_FAILED",
    })
    expect(await harness.store.getAccount("acc-1")).not.toBeNull()
  })

  it("updates settings without touching the credential", async () => {
    const harness = await createHarness()
    await harness.store.saveAccount(seedAccount())
    const view = await harness.service.update({
      accountId: "acc-1",
      displayName: "新名字",
      enabled: false,
      fingerprint: { ...fingerprint, seed: "654321" },
    })
    expect(view.displayName).toBe("新名字")
    expect(view.enabled).toBe(false)
    expect(view.fingerprint.seed).toBe("654321")
    expect(view.proxyId).toBe("p1")
    expect((await harness.store.getAccount("acc-1"))?.credential?.accessToken).toBe("old-access")
  })

  it("unbinds the proxy when update receives null", async () => {
    const harness = await createHarness()
    await harness.store.saveAccount(seedAccount())
    const view = await harness.service.update({ accountId: "acc-1", proxyId: null })
    expect(view.proxyId).toBeNull()
    expect((await harness.store.getAccount("acc-1"))?.proxyId).toBeNull()
    expect((await harness.store.getAccount("acc-1"))?.credential?.accessToken).toBe("old-access")
  })

  it("rejects an update to a proxy that does not exist", async () => {
    const harness = await createHarness()
    await harness.store.saveAccount(seedAccount())
    await expect(
      harness.service.update({ accountId: "acc-1", proxyId: "missing" }),
    ).rejects.toMatchObject({ code: "PROXY_INVALID" })
    expect((await harness.store.getAccount("acc-1"))?.proxyId).toBe("p1")
  })

  it("rejects invalid fingerprints", async () => {
    const harness = await createHarness()
    await harness.store.saveAccount(seedAccount())
    await expect(
      harness.service.update({
        accountId: "acc-1",
        fingerprint: { ...fingerprint, seed: "0" },
      }),
    ).rejects.toMatchObject({ code: "FINGERPRINT_INVALID" })
  })

  it("checks membership before touching the browser or the proxy", async () => {
    const harness = await createHarness({
      membershipError: new ClaudeAccountError("MEMBERSHIP_REQUIRED", "会员校验不通过"),
    })
    await expect(
      harness.service.authorize({ displayName: "工作账号", proxyId: "p1", fingerprint }),
    ).rejects.toMatchObject({ code: "MEMBERSHIP_REQUIRED" })
    expect(harness.browserCalls).toEqual([])
  })
})
