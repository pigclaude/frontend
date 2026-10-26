// 账号服务测试。覆盖添加、直连授权、出口阻断、账号不一致、取消、删除失败、更新和会员门禁。

import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Dispatcher } from "undici"
import { describe, expect, it } from "vitest"
import type { ClaudeAccountEvent } from "@pigclaude/contracts/claude-account"
import { LocalStore, type AccountRecord } from "@pigclaude/local-store"
import type { EgressResult } from "@pigclaude/login-gate/egress-check"
import { BrowserLaunchError, type LaunchBrowserInput } from "./fingerprint-chromium"
import { ClaudeAccountError } from "./errors"
import { ClaudeAccountService, type ClaudeAccountServiceDeps } from "./account-service"
import {
  type ClaudeOAuthProfile,
  type ClaudeOAuthTokens,
  type OAuthCallbackServer,
} from "./subscription-oauth"

const now = Date.parse("2026-10-21T00:00:00.000Z")
const fingerprint = {
  seed: "123456",
  brand: "Chrome",
  platform: "macos",
  lang: "en-US",
  timezone: "America/Los_Angeles",
  canvasNoise: true,
  clientRectsNoise: true,
}

type Harness = {
  service: ClaudeAccountService
  store: LocalStore
  events: ClaudeAccountEvent[]
  browserCalls: string[]
  launchInputs: LaunchBrowserInput[]
  bridgeCalls: Array<{ upstreamProxyUrl: string }>
  egressCalls: Array<{ bridgeUrl: string; upstreamProxyUrl: string; checkUrl: string }>
  exchangeDispatchers: Array<Dispatcher | undefined>
  profileDispatchers: Array<Dispatcher | undefined>
  launched: { promise: Promise<void>; resolve: () => void }
  bridgeClosed: () => boolean
}

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
    expect(harness.launchInputs[0]?.bridgeUrl).toBe("http://127.0.0.1:9999")
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
    expect(harness.launchInputs[0]).not.toHaveProperty("bridgeUrl")
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

async function createHarness(
  options: {
    egress?: EgressResult
    profile?: ClaudeOAuthProfile | null
    tokens?: ClaudeOAuthTokens
    membershipError?: ClaudeAccountError
    deleteError?: Error
    callback?: OAuthCallbackServer
  } = {},
): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), "claude-account-"))
  const store = new LocalStore(dir)
  await store.saveProxy({
    schemaVersion: 1,
    id: "p1",
    name: "p1",
    url: "http://127.0.0.1:1",
    lastTest: null,
  })
  const events: ClaudeAccountEvent[] = []
  const browserCalls: string[] = []
  const launchInputs: LaunchBrowserInput[] = []
  const bridgeCalls: Array<{ upstreamProxyUrl: string }> = []
  const egressCalls: Array<{ bridgeUrl: string; upstreamProxyUrl: string; checkUrl: string }> = []
  const exchangeDispatchers: Array<Dispatcher | undefined> = []
  const profileDispatchers: Array<Dispatcher | undefined> = []
  let resolveLaunched: () => void = () => undefined
  const launched = {
    promise: new Promise<void>((resolve) => {
      resolveLaunched = resolve
    }),
    resolve: () => resolveLaunched(),
  }
  let bridgeClosed = false
  const callback = options.callback ?? {
    redirectUri: "http://localhost:1234/callback",
    waitForCode: async () => "code-1",
    close: async () => undefined,
  }
  const browser = {
    ensureAvailable: async () => {
      browserCalls.push("ensure")
      return "/fake/fingerprint-chromium"
    },
    profileDir: (accountId: string) => join(dir, "browser-profiles", accountId),
    launch: async (input: LaunchBrowserInput) => {
      browserCalls.push("launch")
      launchInputs.push(input)
      launched.resolve()
      return { profileDir: join(dir, "browser-profiles", "acc-1"), pid: 1234 }
    },
    stop: async () => {
      browserCalls.push("stop")
    },
    deleteProfile: async () => {
      if (options.deleteError !== undefined) throw options.deleteError
      browserCalls.push("delete")
    },
    stopAll: async () => undefined,
  }
  const oauth = {
    buildAuthorizeUrl: (input: { state: string }) =>
      `https://claude.test/authorize?state=${input.state}`,
    startCallback: async () => callback,
    exchangeCode: async (input: { dispatcher?: Dispatcher }) => {
      exchangeDispatchers.push(input.dispatcher)
      return options.tokens ?? defaultTokens()
    },
    readProfile: async (input: { dispatcher?: Dispatcher }) => {
      profileDispatchers.push(input.dispatcher)
      return options.profile ?? defaultProfile()
    },
  }
  const deps: ClaudeAccountServiceDeps = {
    store,
    browser,
    oauth,
    startBridge: async (input) => {
      bridgeCalls.push(input)
      return {
        url: "http://127.0.0.1:9999",
        close: async () => {
          bridgeClosed = true
        },
      }
    },
    checkEgress: async (input) => {
      egressCalls.push(input)
      return options.egress ?? { ok: true, ip: "1.1.1.1" }
    },
    ensureMembership: async () => {
      if (options.membershipError !== undefined) throw options.membershipError
    },
    egressCheckUrl: "https://egress.test/trace",
    now: () => now,
    id: () => "acc-1",
    onEvent: (event) => events.push(event),
  }
  return {
    service: new ClaudeAccountService(deps),
    store,
    events,
    browserCalls,
    launchInputs,
    bridgeCalls,
    egressCalls,
    exchangeDispatchers,
    profileDispatchers,
    launched,
    bridgeClosed: () => bridgeClosed,
  }
}

function seedAccount(): AccountRecord {
  return {
    schemaVersion: 3,
    id: "acc-1",
    displayName: "旧账号",
    enabled: true,
    credential: {
      schemaVersion: 1,
      accessToken: "old-access",
      refreshToken: "old-refresh",
      expiresAt: now + 300_000,
      scopes: ["user:inference"],
      accountUuid: "old-account",
      email: "old@example.com",
      organizationUuid: "org",
      subscriptionType: "max",
      rateLimitTier: null,
    },
    needsReauth: false,
    proxyId: "p1",
    fingerprint,
    browserProfileDir: "/tmp/browser-profiles/acc-1",
    exhaustedUntil: null,
    createdAt: "2026-10-21T00:00:00.000Z",
    updatedAt: "2026-10-21T00:00:00.000Z",
  }
}

function defaultTokens(): ClaudeOAuthTokens {
  return {
    accessToken: "access",
    refreshToken: "refresh",
    expiresAt: now + 300_000,
    scopes: ["user:inference"],
  }
}

function defaultProfile(): ClaudeOAuthProfile {
  return {
    accountUuid: "account-1",
    email: "user@example.com",
    organizationUuid: "org",
    subscriptionType: "max",
    rateLimitTier: null,
  }
}
