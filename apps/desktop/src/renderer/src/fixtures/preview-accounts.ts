// 负责浏览器预览用的演示账号、代理和登录流程，只用于没有桌面桥的本地预览。

import type {
  ClaudeAccountEvent,
  ClaudeAccountView,
  ClaudeFingerprintView,
  EgressView,
  ProxyView,
} from "@pigclaude/contracts/claude-account"

const previewFingerprint: ClaudeFingerprintView = {
  seed: "937461",
  brand: "Chrome",
  platform: "macos",
  lang: "en-US",
  timezone: "America/Los_Angeles",
  canvasNoise: true,
  clientRectsNoise: true,
}

/** 浏览器预览里可用的演示账号。 */
export function previewAccounts(): ClaudeAccountView[] {
  return [
    {
      id: "preview-work",
      displayName: "工作 Max",
      enabled: true,
      email: "lin•••@example.com",
      subscriptionType: "max",
      needsReauth: false,
      credentialExpiresAt: Date.now() + 55 * 60 * 1_000,
      // null 表示不绑定代理，演示 direct 账号。
      proxyId: null,
      fingerprint: previewFingerprint,
      createdAt: "2026-10-01T02:10:00.000Z",
      updatedAt: "2026-10-21T09:30:00.000Z",
    },
    {
      id: "preview-primary",
      displayName: "主力 Max",
      enabled: true,
      email: "main•••@example.com",
      subscriptionType: "max",
      needsReauth: false,
      credentialExpiresAt: Date.now() + 3 * 60 * 60 * 1_000,
      proxyId: "preview-sjc",
      fingerprint: { ...previewFingerprint, seed: "184203" },
      createdAt: "2026-09-18T05:00:00.000Z",
      updatedAt: "2026-10-21T08:12:00.000Z",
    },
    {
      id: "preview-legacy",
      displayName: "旧号 Pro",
      enabled: true,
      email: null,
      subscriptionType: "pro",
      needsReauth: true,
      credentialExpiresAt: null,
      proxyId: "preview-sea",
      fingerprint: { ...previewFingerprint, seed: "520117" },
      createdAt: "2026-08-02T11:20:00.000Z",
      updatedAt: "2026-10-19T15:44:00.000Z",
    },
  ]
}

/** 浏览器预览里可用的演示代理。 */
export function previewProxies(): ProxyView[] {
  return [
    {
      id: "preview-la",
      name: "LA-01",
      url: "http://user:***@127.0.0.1:18080",
      lastTest: {
        ok: true,
        ip: "203.0.113.42",
        latencyMs: 186,
        testedAt: "2026-10-21T09:28:00.000Z",
      },
    },
    {
      id: "preview-sjc",
      name: "SJC-02",
      url: "http://user:***@127.0.0.1:18081",
      lastTest: {
        ok: true,
        ip: "198.51.100.17",
        latencyMs: 172,
        testedAt: "2026-10-21T09:29:00.000Z",
      },
    },
    {
      id: "preview-sea",
      name: "SEA-03",
      url: "http://user:***@127.0.0.1:18082",
      lastTest: null,
    },
  ]
}

/** 演示登录流程。保证只在浏览器预览里使用，不触碰真实网络或凭据。 */
export function createPreviewAccountsBridge(input: {
  onEvent: (event: ClaudeAccountEvent) => void
  onAccounts: (accounts: ClaudeAccountView[]) => void
}) {
  let accounts = previewAccounts()
  const emitLater = (event: ClaudeAccountEvent): void => {
    setTimeout(() => {
      input.onEvent(event)
    }, 0)
  }
  return {
    list: async () => accounts,
    authorize: async (request: {
      accountId?: string
      displayName: string
      proxyId: string | null
      fingerprint: ClaudeFingerprintView
    }) => {
      const event = (phase: ClaudeAccountEvent["phase"]): void => {
        emitLater({ accountId: "preview-new", phase, errorCode: null, message: null })
      }
      event("preparing")
      event("checking-egress")
      event("waiting-browser")
      const created: ClaudeAccountView = {
        id: request.accountId ?? "preview-new",
        displayName: request.displayName,
        enabled: true,
        email: "new•••@example.com",
        subscriptionType: "max",
        needsReauth: false,
        credentialExpiresAt: Date.now() + 60 * 60 * 1_000,
        proxyId: request.proxyId,
        fingerprint: request.fingerprint,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      setTimeout(() => {
        accounts = [...accounts.filter((item) => item.id !== created.id), created]
        input.onAccounts(accounts)
        event("authorized")
      }, 3000)
      return Promise.resolve(created)
    },
    cancelAuthorization: async () => undefined,
    update: async (request: {
      accountId: string
      displayName?: string
      enabled?: boolean
      /** 省略表示不变；null 表示解绑代理并改用系统网络。 */
      proxyId?: string | null
      fingerprint?: ClaudeFingerprintView
    }) => {
      accounts = accounts.map((account) =>
        account.id === request.accountId ? { ...account, ...request } : account,
      )
      input.onAccounts(accounts)
      const updated = accounts.find((account) => account.id === request.accountId)
      if (updated === undefined) throw new Error("账号不存在")
      return updated
    },
    remove: async (accountId: string) => {
      accounts = accounts.filter((account) => account.id !== accountId)
      input.onAccounts(accounts)
    },
  }
}

/** 浏览器预览的出口核对结果。 */
export function previewEgress(): EgressView {
  return { ok: true, ip: "203.0.113.42" }
}
