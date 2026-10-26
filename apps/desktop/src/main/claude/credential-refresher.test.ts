// 凭据刷新测试。覆盖未到期、轮换、单飞、需要重新授权、直连刷新和代理缺失。

import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { Dispatcher } from "undici"
import type { AccountRecord, LocalStore as LocalStoreType } from "@pigclaude/local-store"
import { LocalStore } from "@pigclaude/local-store"
import { CredentialRefresher } from "./credential-refresher"
import { ClaudeAccountError } from "./errors"
import {
  SubscriptionOAuthError,
  type ClaudeOAuthTokens,
  type SubscriptionOAuth,
} from "./subscription-oauth"

const now = Date.parse("2026-10-21T00:00:00.000Z")

describe("CredentialRefresher", () => {
  it("returns an account whose credential is not near expiry", async () => {
    const { store, account } = await fixture(now + 60 * 60 * 1_000)
    let calls = 0
    const refresher = new CredentialRefresher({
      store,
      oauth: fakeOAuth(async () => {
        calls += 1
        return tokens()
      }),
      now: () => now,
    })
    expect(await refresher.refreshIfNeeded(account)).toBe(account)
    expect(calls).toBe(0)
  })

  it("refreshes a near-expiry credential and persists the rotated tokens", async () => {
    const { store, account } = await fixture(now + 60 * 1_000)
    const calls: Array<{ refreshToken: string; scopes?: string[] }> = []
    const dispatchers: Array<Dispatcher | undefined> = []
    const refresher = new CredentialRefresher({
      store,
      oauth: fakeOAuth(async (input) => {
        calls.push({ refreshToken: input.refreshToken, scopes: input.scopes })
        dispatchers.push(input.dispatcher)
        return tokens("new-access", "new-refresh", now + 300_000)
      }),
      now: () => now,
    })
    const updated = await refresher.refreshIfNeeded(account)
    expect(updated.credential).toMatchObject({
      accessToken: "new-access",
      refreshToken: "new-refresh",
      expiresAt: now + 300_000,
    })
    expect(calls).toEqual([{ refreshToken: "old-refresh", scopes: ["user:inference"] }])
    expect(dispatchers[0]).toBeDefined()
    expect((await store.getAccount(account.id))?.credential?.accessToken).toBe("new-access")
  })

  it("refreshes a direct account without a proxy dispatcher", async () => {
    const { store, account } = await fixture(now + 60 * 1_000, null)
    await store.removeProxy("p1")
    const dispatchers: Array<Dispatcher | undefined> = []
    const refresher = new CredentialRefresher({
      store,
      oauth: fakeOAuth(async (input) => {
        dispatchers.push(input.dispatcher)
        return tokens("direct-access", "direct-refresh", now + 300_000)
      }),
      now: () => now,
    })
    const updated = await refresher.refreshIfNeeded(account)
    expect(updated.credential?.accessToken).toBe("direct-access")
    expect(dispatchers).toEqual([undefined])
    expect((await store.getAccount(account.id))?.credential?.accessToken).toBe("direct-access")
  })

  it("shares one refresh between concurrent callers", async () => {
    const { store, account } = await fixture(now + 60 * 1_000)
    const gate = deferred<ClaudeOAuthTokens>()
    let calls = 0
    const refresher = new CredentialRefresher({
      store,
      oauth: fakeOAuth(async () => {
        calls += 1
        return gate.promise
      }),
      now: () => now,
    })
    const first = refresher.refresh(account)
    const second = refresher.refresh(account)
    gate.resolve(tokens("shared", "shared-refresh", now + 300_000))
    const [a, b] = await Promise.all([first, second])
    expect(calls).toBe(1)
    expect(a.credential?.accessToken).toBe("shared")
    expect(b.credential?.accessToken).toBe("shared")
  })

  it("clears the credential and marks reauthorization on invalid_grant", async () => {
    const { store, account } = await fixture(now + 60 * 1_000)
    const refresher = new CredentialRefresher({
      store,
      oauth: fakeOAuth(async () => {
        throw new SubscriptionOAuthError("CREDENTIAL_REFRESH_FAILED", "需要重新授权", true)
      }),
      now: () => now,
    })
    await expect(refresher.refresh(account)).rejects.toMatchObject({
      code: "CREDENTIAL_REFRESH_FAILED",
    })
    const stored = await store.getAccount(account.id)
    expect(stored?.credential).toBeNull()
    expect(stored?.needsReauth).toBe(true)
  })

  it("keeps the old credential on a transient failure", async () => {
    const { store, account } = await fixture(now + 60 * 1_000)
    const refresher = new CredentialRefresher({
      store,
      oauth: fakeOAuth(async () => {
        throw new Error("network down")
      }),
      now: () => now,
    })
    await expect(refresher.refresh(account)).rejects.toBeInstanceOf(ClaudeAccountError)
    expect((await store.getAccount(account.id))?.credential?.accessToken).toBe("old-access")
  })

  it("fails clearly when the account proxy is missing", async () => {
    const { store, account } = await fixture(now + 60 * 1_000)
    await store.removeProxy("p1")
    const refresher = new CredentialRefresher({
      store,
      oauth: fakeOAuth(async () => tokens()),
      now: () => now,
    })
    await expect(refresher.refresh(account)).rejects.toMatchObject({ code: "PROXY_UNAVAILABLE" })
  })
})

async function fixture(
  expiresAt: number,
  proxyId: string | null = "p1",
): Promise<{ store: LocalStoreType; account: AccountRecord }> {
  const dir = await mkdtemp(join(tmpdir(), "refresh-"))
  const store = new LocalStore(dir)
  await store.saveProxy({
    schemaVersion: 1,
    id: "p1",
    name: "p1",
    url: "http://127.0.0.1:1",
    lastTest: null,
  })
  const account: AccountRecord = {
    schemaVersion: 3,
    id: "acc-1",
    displayName: "账号",
    enabled: true,
    credential: {
      schemaVersion: 1,
      accessToken: "old-access",
      refreshToken: "old-refresh",
      expiresAt,
      scopes: ["user:inference"],
      accountUuid: "account-uuid",
      email: "user@example.com",
      organizationUuid: "org",
      subscriptionType: "max",
      rateLimitTier: null,
    },
    needsReauth: false,
    proxyId,
    fingerprint: {
      seed: "123456",
      brand: "Chrome",
      platform: "macos",
      lang: "en-US",
      timezone: "America/Los_Angeles",
      canvasNoise: true,
      clientRectsNoise: true,
    },
    browserProfileDir: "/tmp/browser-profiles/acc-1",
    exhaustedUntil: null,
    createdAt: "2026-10-21T00:00:00.000Z",
    updatedAt: "2026-10-21T00:00:00.000Z",
  }
  await store.saveAccount(account)
  return { store, account }
}

function fakeOAuth(
  refresh: (input: {
    refreshToken: string
    scopes?: string[]
    dispatcher?: Dispatcher
  }) => Promise<ClaudeOAuthTokens>,
): Pick<SubscriptionOAuth, "refresh"> {
  return { refresh }
}

function tokens(
  accessToken = "new-access",
  refreshToken = "new-refresh",
  expiresAt = now + 300_000,
): ClaudeOAuthTokens {
  return { accessToken, refreshToken, expiresAt, scopes: ["user:inference"] }
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}
