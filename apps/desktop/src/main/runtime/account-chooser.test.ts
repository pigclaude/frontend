// 负责验证账号选择的过滤、偏好、凭据刷新、冷却和代理缺失处理。

import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  LocalStore,
  type AccountRecord,
  type ClaudeCredential,
  type IpProxy,
} from "@pigclaude/local-store"
import { AccountChooser } from "./account-chooser"

const now = Date.parse("2026-10-26T00:00:00.000Z")
const temporaryDirs: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("AccountChooser", () => {
  it("returns null when no account is saved", async () => {
    const store = await storeWith([])
    const chooser = new AccountChooser({ store, refresher: passThrough(), now: () => now })
    expect(await chooser.choose({ rejectedIds: [] })).toBeNull()
  })

  it.each([
    ["disabled", { enabled: false }],
    ["needing reauthorization", { needsReauth: true }],
    ["without credential", { credential: null }],
    ["cooling down", { exhaustedUntil: new Date(now + 60_000).toISOString() }],
  ])("skips %s accounts", async (_label, overrides) => {
    const store = await storeWith([account("a", overrides)])
    const chooser = new AccountChooser({ store, refresher: passThrough(), now: () => now })
    expect(await chooser.choose({ rejectedIds: [] })).toBeNull()
  })

  it("skips accounts the daemon already rejected", async () => {
    const store = await storeWith([account("a")])
    const chooser = new AccountChooser({ store, refresher: passThrough(), now: () => now })
    expect(await chooser.choose({ rejectedIds: ["a"] })).toBeNull()
  })

  it("returns the preferred account when it is usable", async () => {
    const store = await storeWith([account("a"), account("b")])
    const chooser = new AccountChooser({ store, refresher: passThrough(), now: () => now })
    expect(await chooser.choose({ rejectedIds: [], preferredId: "b" })).toEqual({
      id: "b",
      authorization: "token-b",
      proxyUrl: "http://p1.test:8080",
    })
  })

  it("falls back to user order when the preferred account is unavailable", async () => {
    const store = await storeWith([account("a"), account("b", { enabled: false })])
    const chooser = new AccountChooser({ store, refresher: passThrough(), now: () => now })
    expect((await chooser.choose({ rejectedIds: [], preferredId: "b" }))?.id).toBe("a")
  })

  it("skips an account whose credential refresh fails", async () => {
    const store = await storeWith([account("a"), account("b")])
    const chooser = new AccountChooser({
      store,
      now: () => now,
      refresher: {
        refreshIfNeeded: async (record) => {
          if (record.id === "a") throw new Error("refresh failed")
          return record
        },
      },
    })
    expect((await chooser.choose({ rejectedIds: [] }))?.id).toBe("b")
  })

  it("returns the refreshed access token", async () => {
    const store = await storeWith([account("a")])
    const chooser = new AccountChooser({
      store,
      now: () => now,
      refresher: {
        refreshIfNeeded: async (record) => ({
          ...record,
          credential: { ...credentialFor("a"), accessToken: "refreshed-token" },
        }),
      },
    })
    expect((await chooser.choose({ rejectedIds: [] }))?.authorization).toBe("refreshed-token")
  })

  it("skips accounts whose proxy is missing or empty", async () => {
    const store = await storeWith(
      [account("a", { proxyId: "missing" }), account("b", { proxyId: "empty" }), account("c")],
      [proxy("p1"), proxy("empty", "")],
    )
    const chooser = new AccountChooser({ store, refresher: passThrough(), now: () => now })
    expect((await chooser.choose({ rejectedIds: [] }))?.id).toBe("c")
  })

  it("reports availability without refreshing credentials", async () => {
    let refreshes = 0
    const store = await storeWith([account("a")])
    const chooser = new AccountChooser({
      store,
      now: () => now,
      refresher: {
        refreshIfNeeded: async (record) => {
          refreshes += 1
          return record
        },
      },
    })

    await expect(chooser.hasAvailableAccount()).resolves.toBe(true)
    expect(refreshes).toBe(0)
  })

  it.each([
    ["disabled", { enabled: false }],
    ["needing reauthorization", { needsReauth: true }],
    ["without credential", { credential: null }],
    ["cooling down", { exhaustedUntil: new Date(now + 60_000).toISOString() }],
  ])("reports no available account for %s accounts", async (_label, overrides) => {
    const store = await storeWith([account("a", overrides)])
    const chooser = new AccountChooser({ store, refresher: passThrough(), now: () => now })
    await expect(chooser.hasAvailableAccount()).resolves.toBe(false)
  })

  it("reports no available account when the proxy is missing or empty", async () => {
    const store = await storeWith(
      [account("a", { proxyId: "missing" }), account("b", { proxyId: "empty" })],
      [proxy("empty", "")],
    )
    const chooser = new AccountChooser({ store, refresher: passThrough(), now: () => now })
    await expect(chooser.hasAvailableAccount()).resolves.toBe(false)
  })

  it("reads the latest accounts on every call", async () => {
    const store = await storeWith([account("a")])
    const chooser = new AccountChooser({ store, refresher: passThrough(), now: () => now })
    expect((await chooser.choose({ rejectedIds: [] }))?.id).toBe("a")
    await store.saveAccount(account("b"))
    await store.saveAccount(account("a", { enabled: false }))
    expect((await chooser.choose({ rejectedIds: [] }))?.id).toBe("b")
  })
})

async function storeWith(
  accounts: AccountRecord[],
  proxies: IpProxy[] = [proxy("p1")],
): Promise<LocalStore> {
  const dir = await mkdtemp(join(tmpdir(), "account-chooser-"))
  temporaryDirs.push(dir)
  const store = new LocalStore(dir)
  for (const item of proxies) await store.saveProxy(item)
  for (const item of accounts) await store.saveAccount(item)
  return store
}

function account(id: string, overrides: Partial<AccountRecord> = {}): AccountRecord {
  return {
    schemaVersion: 3,
    id,
    displayName: id,
    enabled: true,
    credential: credentialFor(id),
    needsReauth: false,
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
    browserProfileDir: `/tmp/browser-profiles/${id}`,
    exhaustedUntil: null,
    createdAt: "2026-10-26T00:00:00.000Z",
    updatedAt: "2026-10-26T00:00:00.000Z",
    ...overrides,
  }
}

function credentialFor(id: string): ClaudeCredential {
  return {
    schemaVersion: 1,
    accessToken: `token-${id}`,
    refreshToken: `refresh-${id}`,
    expiresAt: now + 60 * 60 * 1_000,
    scopes: ["user:inference"],
    accountUuid: `uuid-${id}`,
    email: `${id}@example.com`,
    organizationUuid: "org",
    subscriptionType: "max",
    rateLimitTier: null,
  }
}

function proxy(id: string, url = "http://p1.test:8080"): IpProxy {
  return { schemaVersion: 1, id, name: id, url, lastTest: null }
}

function passThrough(): { refreshIfNeeded: (record: AccountRecord) => Promise<AccountRecord> } {
  return { refreshIfNeeded: async (record) => record }
}
