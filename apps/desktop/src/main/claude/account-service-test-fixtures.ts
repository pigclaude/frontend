// 为 Claude 账号服务测试创建临时存储、合成代理和 OAuth 依赖。

import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Dispatcher } from "undici"
import type { ClaudeAccountEvent, ClaudeFingerprintView } from "@pigclaude/contracts/claude-account"
import { LocalStore, type AccountRecord } from "@pigclaude/local-store"
import type { EgressResult } from "@pigclaude/login-gate/egress-check"
import type { ProxyBridge } from "@pigclaude/login-gate/proxy-bridge"
import { BrowserLaunchError, type LaunchBrowserInput } from "./fingerprint-chromium"
import type { ClaudeAccountError } from "./errors"
import { ClaudeAccountService, type ClaudeAccountServiceDeps } from "./account-service"
import type {
  ClaudeOAuthProfile,
  ClaudeOAuthTokens,
  OAuthCallbackServer,
} from "./subscription-oauth"

const now = Date.parse("2026-10-21T00:00:00.000Z")
/** 测试用的合成 Claude 账号指纹。 */
export const fingerprint: ClaudeFingerprintView = {
  seed: "123456",
  brand: "Chrome",
  platform: "macos",
  lang: "en-US",
  timezone: "America/Los_Angeles",
  canvasNoise: "1",
  clientRectsNoise: "1",
}

/** 账号服务测试所需的合成依赖和观测结果。 */
export type Harness = {
  service: ClaudeAccountService
  store: LocalStore
  events: ClaudeAccountEvent[]
  browserCalls: string[]
  launchInputs: LaunchBrowserInput[]
  bridgeCalls: Array<{ upstreamProxyUrl: string }>
  egressCalls: Array<{ bridgeUrl: string; upstreamProxyUrl: string; checkUrl: string }>
  callbackCalls: string[]
  exchangeDispatchers: Array<Dispatcher | undefined>
  profileDispatchers: Array<Dispatcher | undefined>
  launched: { promise: Promise<void>; resolve: () => void }
  bridgeClosed: () => boolean
}

/** 创建只使用临时存储和合成外部依赖的账号服务。 */
export async function createHarness(
  options: {
    egress?: EgressResult
    profile?: ClaudeOAuthProfile | null
    tokens?: ClaudeOAuthTokens
    membershipError?: ClaudeAccountError
    deleteError?: Error
    callback?: OAuthCallbackServer
    bridgeUrl?: string
    bridgeMissing?: boolean
    bridgeUrlAfterEgress?: string
    membershipWait?: () => Promise<void>
    proxyProtectionUnavailable?: boolean
    browser?: ClaudeAccountServiceDeps["browser"]
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
  const callbackCalls: string[] = []
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
  const bridge = {
    url: options.bridgeUrl ?? "http://127.0.0.1:9999",
    close: async () => {
      bridgeClosed = true
    },
  }
  const callback = options.callback ?? {
    redirectUri: "http://localhost:1234/callback",
    waitForCode: async () => "code-1",
    close: async () => undefined,
  }
  const browser = {
    ensureBoundProxyProtection: () => {
      // 编排测试使用可控替身；真实启动器在没有可信内核时始终阻断。
      if (options.proxyProtectionUnavailable) {
        throw new BrowserLaunchError("BROWSER_START_FAILED", "当前内核无法证明受管代理保护")
      }
    },
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
    startCallback: async () => {
      callbackCalls.push("start")
      return callback
    },
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
    browser: options.browser ?? browser,
    oauth,
    startBridge: async (input) => {
      bridgeCalls.push(input)
      if (options.bridgeMissing) return null as unknown as ProxyBridge
      return bridge
    },
    checkEgress: async (input) => {
      egressCalls.push(input)
      if (options.bridgeUrlAfterEgress !== undefined) bridge.url = options.bridgeUrlAfterEgress
      return options.egress ?? { ok: true, ip: "1.1.1.1" }
    },
    ensureMembership: async () => {
      if (options.membershipError !== undefined) throw options.membershipError
      await options.membershipWait?.()
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
    callbackCalls,
    exchangeDispatchers,
    profileDispatchers,
    launched,
    bridgeClosed: () => bridgeClosed,
  }
}

/** 返回用于测试存量配置保留的合成账号。 */
export function seedAccount(): AccountRecord {
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
