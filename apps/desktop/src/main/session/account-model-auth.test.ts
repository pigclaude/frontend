// 负责验证模型目录凭据：挑可用账号、刷新过期凭据、缺少 org 时退回 null。

import type { AccountRecord, LocalStore } from "@pigclaude/local-store"
import { describe, expect, it, vi } from "vitest"
import { accountModelAuth } from "./account-model-auth"

function account(overrides: Partial<AccountRecord> = {}): AccountRecord {
  return {
    schemaVersion: 4,
    id: "account-a",
    displayName: "主力 Max",
    enabled: true,
    needsReauth: false,
    proxyId: null,
    exhaustedUntil: null,
    credential: {
      schemaVersion: 1,
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAt: Date.now() + 60 * 60 * 1_000,
      scopes: [],
      accountUuid: "account-uuid",
      email: "model@example.test",
      organizationUuid: "organization-uuid",
      subscriptionType: "pro",
      rateLimitTier: "default",
    },
    fingerprint: {
      seed: "123456",
      brand: "Chrome",
      platform: "macos",
      lang: "en-US",
      timezone: "Asia/Shanghai",
      canvasNoise: "1",
      clientRectsNoise: "1",
    },
    browserProfileDir: "/tmp/profile",
    createdAt: "2026-10-21T00:00:00.000Z",
    updatedAt: "2026-10-21T00:00:00.000Z",
    ...overrides,
  }
}

function store(accounts: AccountRecord[]): Pick<LocalStore, "listAccounts" | "listProxies"> {
  return {
    listAccounts: async () => accounts,
    listProxies: async () => [],
  }
}

describe("accountModelAuth", () => {
  it("returns the first selectable account's credential", async () => {
    const refresher = { refreshIfNeeded: vi.fn(async (item: AccountRecord) => item) }
    const auth = await accountModelAuth(store([account()]), refresher, null)

    expect(auth).toEqual({
      accessToken: "access-token",
      accountUuid: "account-uuid",
      email: "model@example.test",
      organizationUuid: "organization-uuid",
    })
    expect(refresher.refreshIfNeeded).toHaveBeenCalledTimes(1)
  })

  it("skips accounts that cannot be selected", async () => {
    const refresher = { refreshIfNeeded: vi.fn(async (item: AccountRecord) => item) }
    const auth = await accountModelAuth(
      store([
        account({ id: "disabled", enabled: false }),
        account({ id: "reauth", needsReauth: true }),
        account({ id: "exhausted", exhaustedUntil: "2999-01-01T00:00:00.000Z" }),
        account({ id: "usable" }),
      ]),
      refresher,
      null,
    )

    expect(auth?.accountUuid).toBe("account-uuid")
    expect(refresher.refreshIfNeeded).toHaveBeenCalledWith(
      expect.objectContaining({ id: "usable" }),
    )
  })

  it("uses the refreshed credential", async () => {
    const refreshed = account({
      credential: {
        ...account().credential!,
        accessToken: "refreshed-token",
      },
    })
    const refresher = { refreshIfNeeded: vi.fn(async () => refreshed) }
    const auth = await accountModelAuth(store([account()]), refresher, null)

    expect(auth?.accessToken).toBe("refreshed-token")
  })

  it("returns null without an account or organization", async () => {
    const refresher = { refreshIfNeeded: vi.fn(async (item: AccountRecord) => item) }

    expect(await accountModelAuth(store([]), refresher, null)).toBeNull()
    expect(
      await accountModelAuth(
        store([
          account({
            credential: { ...account().credential!, organizationUuid: null },
          }),
        ]),
        refresher,
        null,
      ),
    ).toBeNull()
  })
})
