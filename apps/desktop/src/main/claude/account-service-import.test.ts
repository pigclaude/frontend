// 账号服务的 Claude CLI 导入测试：profile 优先、元数据回退、去重更新、冲突、会员门禁和脱敏。

import { mkdtemp, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  defaultClaudeFingerprint,
  type ClaudeAccountEvent,
} from "@pigclaude/contracts/claude-account"
import { LocalStore, type AccountRecord } from "@pigclaude/local-store"
import {
  ClaudeAccountService,
  type ClaudeAccountServiceDeps,
  type ImportClaudeCliAccountInput,
} from "./account-service"
import type { ClaudeCliAccountMetadata } from "./cli-account-metadata"
import type { ClaudeCliCredential } from "./cli-credential-reader"
import { ClaudeAccountError } from "./errors"
import type { ClaudeOAuthProfile } from "./subscription-oauth"

const now = Date.parse("2026-10-26T00:00:00.000Z")
const accessToken = "cli-access-token"
const refreshToken = "cli-refresh-token"

describe("ClaudeAccountService.importFromClaudeCli", () => {
  it("imports with profile identity, default network and default fingerprint", async () => {
    const harness = await createHarness({
      metadata: metadata({
        accountUuid: "metadata-uuid",
        emailAddress: "metadata@example.com",
        fullName: "元数据姓名",
        organizationUuid: "metadata-org",
      }),
      profile: profile({
        accountUuid: "profile-uuid",
        email: "profile@example.com",
        organizationUuid: "profile-org",
        subscriptionType: "max",
        rateLimitTier: "default_claude_max_20x",
      }),
    })

    const view = await harness.service.importFromClaudeCli({
      confirmCopy: true,
      displayName: " 导入账号 ",
    })

    expect(view).toMatchObject({
      id: "imported-id",
      displayName: "导入账号",
      enabled: true,
      email: "profile@example.com",
      subscriptionType: "max",
      needsReauth: false,
      proxyId: null,
      exhaustedUntil: null,
    })
    expect(view.fingerprint).toEqual(defaultClaudeFingerprint())
    expect(harness.profileTokens).toEqual([accessToken])
    expect(harness.membershipCalls).toBe(1)

    const stored = await harness.store.getAccount("imported-id")
    expect(stored?.credential).toMatchObject({
      schemaVersion: 1,
      accessToken,
      refreshToken,
      expiresAt: now + 3_600_000,
      scopes: ["user:inference", "user:profile"],
      accountUuid: "profile-uuid",
      email: "profile@example.com",
      organizationUuid: "profile-org",
      subscriptionType: "max",
      rateLimitTier: "default_claude_max_20x",
    })
    expect(stored?.browserProfileDir).toBe(join(harness.dir, "browser-profiles", "imported-id"))
    expect(stored?.createdAt).toBe(new Date(now).toISOString())
    expect(stored?.updatedAt).toBe(new Date(now).toISOString())
    await expect(stat(stored?.browserProfileDir ?? "")).rejects.toThrow()

    expect(harness.events).toEqual([])
    const exposed = JSON.stringify({ view, events: harness.events })
    expect(exposed).not.toContain(accessToken)
    expect(exposed).not.toContain(refreshToken)
  })

  it("falls back to oauthAccount metadata and prefers metadata over the CLI rate limit tier", async () => {
    const harness = await createHarness({
      credential: cliCredential({ rateLimitTier: "cli-tier" }),
      metadata: metadata({
        accountUuid: "metadata-uuid",
        emailAddress: "cli-user@example.com",
        displayName: "CLI 显示名",
        organizationUuid: "metadata-org",
        organizationRateLimitTier: "metadata-tier",
      }),
      profileError: new Error("profile unavailable"),
    })

    const view = await harness.service.importFromClaudeCli({ confirmCopy: true })

    expect(view).toMatchObject({
      displayName: "CLI 显示名",
      email: "cli-user@example.com",
      subscriptionType: "pro",
    })
    expect((await harness.store.getAccount("imported-id"))?.credential).toMatchObject({
      accountUuid: "metadata-uuid",
      email: "cli-user@example.com",
      organizationUuid: "metadata-org",
      subscriptionType: "pro",
      rateLimitTier: "metadata-tier",
    })
  })

  it("falls back to the metadata organization type when neither profile nor CLI has one", async () => {
    const harness = await createHarness({
      credential: cliCredential({ subscriptionType: null }),
      metadata: metadata({ organizationType: "claude_max" }),
      profileError: new Error("profile unavailable"),
    })

    const view = await harness.service.importFromClaudeCli({ confirmCopy: true })

    expect(view.subscriptionType).toBe("claude_max")
    expect((await harness.store.getAccount("imported-id"))?.credential).toMatchObject({
      subscriptionType: "claude_max",
    })
  })

  it("uses the email local part or the fixed fallback for the display name", async () => {
    const withEmail = await createHarness({
      profile: profile({ email: "local-part@example.com" }),
    })
    expect((await withEmail.service.importFromClaudeCli({ confirmCopy: true })).displayName).toBe(
      "local-part",
    )

    const withoutIdentity = await createHarness({})
    expect(
      (await withoutIdentity.service.importFromClaudeCli({ confirmCopy: true })).displayName,
    ).toBe("Claude CLI 账号")
  })

  it("updates an account matched by accountUuid and keeps its settings", async () => {
    const harness = await createHarness({
      profile: profile({
        accountUuid: "shared-uuid",
        email: "new@example.com",
        subscriptionType: "max",
      }),
    })
    await harness.store.saveAccount(
      seedAccount({
        credential: {
          schemaVersion: 1,
          accessToken: "old-access",
          refreshToken: "old-refresh",
          expiresAt: now + 60_000,
          scopes: ["user:inference"],
          accountUuid: "shared-uuid",
          email: "old@example.com",
          organizationUuid: "old-org",
          subscriptionType: "pro",
          rateLimitTier: null,
        },
        enabled: false,
        proxyId: "p1",
        exhaustedUntil: "2026-10-26T02:00:00.000Z",
      }),
    )

    const view = await harness.service.importFromClaudeCli({
      confirmCopy: true,
      displayName: "重新导入",
    })

    expect(view).toMatchObject({
      id: "existing-id",
      displayName: "重新导入",
      enabled: false,
      email: "new@example.com",
      subscriptionType: "max",
      needsReauth: false,
      proxyId: "p1",
      exhaustedUntil: "2026-10-26T02:00:00.000Z",
      createdAt: "2026-10-20T00:00:00.000Z",
    })
    expect(view.fingerprint.seed).toBe("424242")
    const stored = await harness.store.getAccount("existing-id")
    expect(stored?.credential?.accessToken).toBe(accessToken)
    expect(stored?.credential?.accountUuid).toBe("shared-uuid")
    expect(stored?.browserProfileDir).toBe("/old/browser-profiles/existing-id")
    expect(stored?.updatedAt).toBe(new Date(now).toISOString())
    expect(await harness.store.listAccounts()).toHaveLength(1)
    expect(harness.events).toEqual([])
  })

  it("keeps the custom display name of an existing account without an explicit name", async () => {
    const harness = await createHarness({
      metadata: metadata({ fullName: "CLI 姓名" }),
      profile: profile({ accountUuid: "shared-uuid", email: "new@example.com" }),
    })
    await harness.store.saveAccount(
      seedAccount({
        displayName: "工作 Max",
        credential: {
          schemaVersion: 1,
          accessToken: "old-access",
          refreshToken: "old-refresh",
          expiresAt: now + 60_000,
          scopes: ["user:inference"],
          accountUuid: "shared-uuid",
          email: "old@example.com",
          organizationUuid: null,
          subscriptionType: null,
          rateLimitTier: null,
        },
      }),
    )

    const view = await harness.service.importFromClaudeCli({ confirmCopy: true })

    expect(view.displayName).toBe("工作 Max")
    expect((await harness.store.getAccount("existing-id"))?.displayName).toBe("工作 Max")
    expect(harness.events).toEqual([])
  })

  it("deduplicates by email and fills a missing accountUuid", async () => {
    const harness = await createHarness({
      profile: profile({ accountUuid: "new-uuid", email: "Same@Example.com" }),
    })
    await harness.store.saveAccount(
      seedAccount({
        credential: {
          schemaVersion: 1,
          accessToken: "old-access",
          refreshToken: "old-refresh",
          expiresAt: now + 60_000,
          scopes: ["user:inference"],
          accountUuid: null,
          email: "same@example.com",
          organizationUuid: null,
          subscriptionType: null,
          rateLimitTier: null,
        },
      }),
    )

    const view = await harness.service.importFromClaudeCli({ confirmCopy: true })

    expect(view.id).toBe("existing-id")
    expect((await harness.store.getAccount("existing-id"))?.credential).toMatchObject({
      accessToken,
      accountUuid: "new-uuid",
      email: "Same@Example.com",
    })
    expect(await harness.store.listAccounts()).toHaveLength(1)
  })

  it("refuses to overwrite an account bound to another Claude account", async () => {
    const harness = await createHarness({
      profile: profile({ accountUuid: "imported-uuid", email: "same@example.com" }),
    })
    await harness.store.saveAccount(
      seedAccount({
        credential: {
          schemaVersion: 1,
          accessToken: "old-access",
          refreshToken: "old-refresh",
          expiresAt: now + 60_000,
          scopes: ["user:inference"],
          accountUuid: "other-uuid",
          email: "same@example.com",
          organizationUuid: null,
          subscriptionType: null,
          rateLimitTier: null,
        },
      }),
    )

    await expect(harness.service.importFromClaudeCli({ confirmCopy: true })).rejects.toMatchObject({
      code: "ACCOUNT_MISMATCH",
      message: "已有账号绑定了另一个 Claude 账号",
    })
    expect((await harness.store.getAccount("existing-id"))?.credential?.accessToken).toBe(
      "old-access",
    )
    expect(harness.events).toEqual([])
  })

  it.each([
    ["missing", {}],
    ["false", { confirmCopy: false }],
  ] as const)("rejects %s confirmCopy before membership and keychain", async (_label, input) => {
    const harness = await createHarness({})
    await expect(
      harness.service.importFromClaudeCli(input as ImportClaudeCliAccountInput),
    ).rejects.toMatchObject({ code: "INVALID_INPUT", message: "请先确认复制 Claude CLI 凭据" })
    expect(harness.membershipCalls).toBe(0)
    expect(harness.credentialCalls).toBe(0)
    expect(harness.events).toEqual([])
  })

  it.each([
    ["already expired", now],
    ["within the safety margin", now + 30_000],
  ] as const)("rejects a CLI credential that is %s", async (_label, expiresAt) => {
    const harness = await createHarness({
      credential: cliCredential({ expiresAt }),
    })
    await expect(harness.service.importFromClaudeCli({ confirmCopy: true })).rejects.toMatchObject({
      code: "CLI_CREDENTIAL_EXPIRED",
      message: "Claude CLI 凭据已过期，请先在 Claude CLI 中刷新",
    })
    expect(harness.profileTokens).toEqual([])
    expect(await harness.store.listAccounts()).toEqual([])
    expect(harness.events).toEqual([])
  })

  it("checks membership before reading the keychain", async () => {
    const harness = await createHarness({
      membershipError: new ClaudeAccountError("MEMBERSHIP_REQUIRED", "会员校验不通过"),
    })
    await expect(harness.service.importFromClaudeCli({ confirmCopy: true })).rejects.toMatchObject({
      code: "MEMBERSHIP_REQUIRED",
    })
    expect(harness.credentialCalls).toBe(0)
    expect(await harness.store.listAccounts()).toEqual([])
  })

  it("propagates reader errors without copying token material", async () => {
    const harness = await createHarness({
      credentialError: new ClaudeAccountError(
        "CLI_KEYCHAIN_DENIED",
        "无法读取 Claude CLI 凭据，请允许访问钥匙串后重试",
      ),
    })
    await expect(harness.service.importFromClaudeCli({ confirmCopy: true })).rejects.toMatchObject({
      code: "CLI_KEYCHAIN_DENIED",
      message: "无法读取 Claude CLI 凭据，请允许访问钥匙串后重试",
    })
    expect(harness.events).toEqual([])
  })
})

type Harness = {
  service: ClaudeAccountService
  store: LocalStore
  dir: string
  events: ClaudeAccountEvent[]
  membershipCalls: number
  credentialCalls: number
  profileTokens: string[]
}

async function createHarness(options: {
  credential?: ClaudeCliCredential
  credentialError?: ClaudeAccountError
  metadata?: ClaudeCliAccountMetadata | null
  profile?: ClaudeOAuthProfile | null
  profileError?: Error
  membershipError?: ClaudeAccountError
}): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), "claude-cli-import-"))
  const store = new LocalStore(dir)
  const events: ClaudeAccountEvent[] = []
  const profileTokens: string[] = []
  let membershipCalls = 0
  let credentialCalls = 0
  const deps: ClaudeAccountServiceDeps = {
    store,
    browser: {
      ensureBoundProxyProtection: () => {
        throw new Error("unexpected capability check")
      },
      ensureAvailable: async () => "/fake/fingerprint-chromium",
      launch: async () => {
        throw new Error("unexpected launch")
      },
      deleteProfile: async () => undefined,
      profileDir: (accountId) => join(dir, "browser-profiles", accountId),
      dispose: async () => undefined,
    },
    oauth: {
      buildAuthorizeUrl: () => "https://claude.test/authorize",
      startCallback: async () => {
        throw new Error("unexpected callback")
      },
      exchangeCode: async () => {
        throw new Error("unexpected exchange")
      },
      readProfile: async ({ accessToken: token }) => {
        profileTokens.push(token)
        if (options.profileError !== undefined) throw options.profileError
        return options.profile ?? null
      },
    },
    checkEgress: async () => ({ ok: true, ip: "203.0.113.42" }),
    ensureMembership: async () => {
      membershipCalls += 1
      if (options.membershipError !== undefined) throw options.membershipError
    },
    readCliCredential: async () => {
      credentialCalls += 1
      if (options.credentialError !== undefined) throw options.credentialError
      return options.credential ?? cliCredential()
    },
    readCliAccountMetadata: async () => options.metadata ?? null,
    now: () => now,
    id: () => "imported-id",
    onEvent: (event) => events.push(event),
  }
  return {
    service: new ClaudeAccountService(deps),
    store,
    dir,
    events,
    get membershipCalls() {
      return membershipCalls
    },
    get credentialCalls() {
      return credentialCalls
    },
    profileTokens,
  }
}

function cliCredential(overrides: Partial<ClaudeCliCredential> = {}): ClaudeCliCredential {
  return {
    accessToken,
    refreshToken,
    expiresAt: now + 3_600_000,
    refreshTokenExpiresAt: null,
    scopes: ["user:inference", "user:profile"],
    subscriptionType: "pro",
    rateLimitTier: "default_claude_pro",
    ...overrides,
  }
}

function metadata(overrides: Partial<ClaudeCliAccountMetadata> = {}): ClaudeCliAccountMetadata {
  return {
    accountUuid: null,
    emailAddress: null,
    displayName: null,
    fullName: null,
    organizationUuid: null,
    organizationName: null,
    organizationType: null,
    organizationRateLimitTier: null,
    ...overrides,
  }
}

function profile(overrides: Partial<ClaudeOAuthProfile> = {}): ClaudeOAuthProfile {
  return {
    accountUuid: null,
    email: null,
    organizationUuid: null,
    subscriptionType: null,
    rateLimitTier: null,
    ...overrides,
  }
}

function seedAccount(overrides: Partial<AccountRecord> = {}): AccountRecord {
  return {
    schemaVersion: 3,
    id: "existing-id",
    displayName: "旧名字",
    enabled: true,
    credential: null,
    needsReauth: true,
    proxyId: null,
    fingerprint: {
      ...defaultClaudeFingerprint(),
      seed: "424242",
      lang: "en-US",
      timezone: "America/Los_Angeles",
    },
    browserProfileDir: "/old/browser-profiles/existing-id",
    exhaustedUntil: null,
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-20T00:00:00.000Z",
    ...overrides,
  }
}
