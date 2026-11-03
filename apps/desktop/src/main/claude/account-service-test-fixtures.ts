// 为 Claude 账号服务测试创建临时存储、合成代理和 OAuth 依赖。

import { lstat, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Dispatcher } from "undici"
import type { ClaudeAccountEvent, ClaudeFingerprintView } from "@pigclaude/contracts/claude-account"
import { LocalStore, type AccountRecord } from "@pigclaude/local-store"
import type { EgressResult } from "@pigclaude/login-gate/egress-check"
import type { ProxyRuntime } from "@pigclaude/login-gate/proxy-runtime"
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
  authorizeRedirectUris: string[]
  exchangeRedirectUris: string[]
  exchangeDispatchers: Array<Dispatcher | undefined>
  profileDispatchers: Array<Dispatcher | undefined>
  launched: { promise: Promise<void>; resolve: () => void }
  bridgeClosed: () => boolean
  /** 仅清理本次夹具创建且经身份核验的临时目录。 */
  cleanup: () => Promise<void>
}

/** 创建只使用临时存储和合成外部依赖的账号服务。 */
export async function createHarness(
  options: {
    egress?: EgressResult
    profile?: ClaudeOAuthProfile | null
    tokens?: ClaudeOAuthTokens
    membershipError?: ClaudeAccountError
    deleteError?: Error
    stopError?: Error
    stopWait?: () => Promise<void>
    deleteWait?: () => Promise<void>
    readCliCredential?: ClaudeAccountServiceDeps["readCliCredential"]
    readCliAccountMetadata?: ClaudeAccountServiceDeps["readCliAccountMetadata"]
    callback?: OAuthCallbackServer
    bridgeUrl?: string
    bridgeMissing?: boolean
    bridgeUrlAfterEgress?: string
    membershipWait?: () => Promise<void>
    callbackStartWait?: () => Promise<void>
    proxyProtectionUnavailable?: boolean
    proxyRuntimeUnavailable?: boolean
    browser?: ClaudeAccountServiceDeps["browser"]
    oauth?: ClaudeAccountServiceDeps["oauth"]
  } = {},
): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), "claude-account-"))
  const identity = await lstat(dir)
  let cleaned = false
  const cleanup = async (): Promise<void> => {
    if (cleaned) return
    const current = await lstat(dir)
    if (!current.isDirectory() || current.dev !== identity.dev || current.ino !== identity.ino) {
      throw new Error("账号测试目录身份发生变化")
    }
    await rm(dir, { recursive: true })
    cleaned = true
  }
  const store = new LocalStore(dir)
  try {
    await store.saveProxy({
      schemaVersion: 1,
      id: "p1",
      name: "p1",
      url: "http://127.0.0.1:1",
      lastTest: null,
    })
  } catch (error) {
    try {
      await cleanup()
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "账号测试夹具创建失败且清理未完成")
    }
    throw error
  }
  const events: ClaudeAccountEvent[] = []
  const browserCalls: string[] = []
  const launchInputs: LaunchBrowserInput[] = []
  const bridgeCalls: Array<{ upstreamProxyUrl: string }> = []
  const egressCalls: Array<{ bridgeUrl: string; upstreamProxyUrl: string; checkUrl: string }> = []
  const callbackCalls: string[] = []
  const authorizeRedirectUris: string[] = []
  const exchangeRedirectUris: string[] = []
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
    url: options.bridgeUrl ?? "socks5://127.0.0.1:9999",
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
      input.assertCanSpawn?.()
      browserCalls.push("launch")
      launchInputs.push(input)
      launched.resolve()
      return {
        profileDir: join(dir, "browser-profiles", "acc-1"),
        pid: 1234,
        stop: async () => {
          browserCalls.push("stop")
          await options.stopWait?.()
          if (options.stopError !== undefined) throw options.stopError
        },
      }
    },
    stop: async () => {
      browserCalls.push("stop")
    },
    deleteProfile: async () => {
      if (options.deleteError !== undefined) throw options.deleteError
      browserCalls.push("delete")
      await options.deleteWait?.()
    },
    stopAll: async () => undefined,
    dispose: async () => undefined,
  }
  const oauth = {
    buildAuthorizeUrl: (input: { state: string; redirectUri: string }) => {
      authorizeRedirectUris.push(input.redirectUri)
      return `https://claude.test/authorize?state=${input.state}`
    },
    startCallback: async () => {
      callbackCalls.push("start")
      await options.callbackStartWait?.()
      return callback
    },
    exchangeCode: async (input: { dispatcher?: Dispatcher; redirectUri: string }) => {
      exchangeRedirectUris.push(input.redirectUri)
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
    ...(options.readCliCredential === undefined
      ? {}
      : { readCliCredential: options.readCliCredential }),
    ...(options.readCliAccountMetadata === undefined
      ? {}
      : { readCliAccountMetadata: options.readCliAccountMetadata }),
    browser: options.browser ?? browser,
    oauth: options.oauth ?? oauth,
    startProxyRuntime: options.proxyRuntimeUnavailable
      ? undefined
      : async (input) => {
          bridgeCalls.push(input)
          if (options.bridgeMissing) return null as unknown as ProxyRuntime
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
    authorizeRedirectUris,
    exchangeRedirectUris,
    exchangeDispatchers,
    profileDispatchers,
    launched,
    bridgeClosed: () => bridgeClosed,
    cleanup,
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
