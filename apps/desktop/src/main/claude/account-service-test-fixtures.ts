// 为 Claude 账号服务测试创建临时存储、合成代理和 OAuth 依赖。

import { lstat, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Dispatcher } from "undici"
import type { ClaudeAccountEvent, ClaudeFingerprintView } from "@pigclaude/contracts/claude-account"
import { LocalStore, type AccountRecord } from "@pigclaude/local-store"
import type { EgressResult } from "@pigclaude/login-gate/egress-check"
import type { ProxyRuntime } from "@pigclaude/login-gate/proxy-runtime"
import type { XrayHttpRequest } from "@pigclaude/login-gate/xray-http"
import type { LaunchBrowserInput } from "./fingerprint-chromium"
import {
  syntheticEnvironmentReport,
  syntheticNativeEvidence,
} from "./environment-check-test-fixtures"
import { ClaudeAccountError } from "./errors"
import { ClaudeAccountService, type ClaudeAccountServiceDeps } from "./account-service"
import type {
  ClaudeOAuthProfile,
  ClaudeOAuthTokens,
  OAuthCallbackServer,
} from "./subscription-oauth"

const now = Date.parse("2026-10-21T00:00:00.000Z")

/** 创建可重复读取取消结果的等待中合成回调。 */
export function createWaitingCallback(): OAuthCallbackServer {
  let reject: (error: Error) => void = () => undefined
  let closed = false
  let complete = false
  const code = new Promise<string>((_resolve, fail) => {
    reject = fail
  })
  void code.catch(() => undefined)
  const cancel = () => {
    if (complete) return
    complete = true
    reject(new ClaudeAccountError("AUTHORIZATION_CANCELLED", "取消"))
  }
  return {
    redirectUri: "http://localhost:1234/callback",
    isComplete: () => complete,
    waitForCode: () => code,
    cancel,
    close: async () => {
      if (closed) return
      closed = true
      cancel()
    },
  }
}

/** 等待合成流程到达指定阶段；流程提前结束或超时则明确失败。 */
export async function waitForTestSignal(
  signal: Promise<void>,
  operation: Promise<unknown>,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      signal,
      operation.then(() => {
        throw new Error("合成流程在目标阶段前结束")
      }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("等待合成阶段超时")), 10_000)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
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
  exchangeXrayRequests: Array<XrayHttpRequest | undefined>
  profileXrayRequests: Array<XrayHttpRequest | undefined>
  launched: { promise: Promise<void>; resolve: () => void }
  bridgeClosed: () => boolean
  /** 仅清理本次夹具创建且经身份核验的临时目录。 */
  cleanup: () => Promise<void>
}

/** 创建只使用临时存储和合成外部依赖的账号服务。 */
export async function createHarness(
  options: {
    store?: LocalStore
    id?: () => string
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
    proxyRuntime?: ProxyRuntime
    bridgeMissing?: boolean
    bridgeUrlAfterEgress?: string
    membershipWait?: () => Promise<void>
    callbackStartWait?: () => Promise<void>
    checkEgressWait?: ClaudeAccountServiceDeps["checkEgress"]
    proxyRuntimeUnavailable?: boolean
    browser?: ClaudeAccountServiceDeps["browser"]
    oauth?: ClaudeAccountServiceDeps["oauth"]
    now?: (() => number) | undefined
    nativeDiagnostics?: ClaudeAccountServiceDeps["nativeDiagnostics"]
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
  const store = options.store ?? new LocalStore(dir)
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
  const exchangeXrayRequests: Array<XrayHttpRequest | undefined> = []
  const profileXrayRequests: Array<XrayHttpRequest | undefined> = []
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
    isComplete: () => true,
    waitForCode: async () => "code-1",
    cancel: () => undefined,
    close: async () => undefined,
  }
  const browser = {
    ensureAvailable: async () => {
      browserCalls.push("ensure")
      return "/fake/fingerprint-chromium"
    },
    profileDir: (accountId: string) => join(dir, "browser-profiles", accountId),
    launch: async (input: LaunchBrowserInput) => {
      input.assertCanSpawn?.()
      // 此端口是合成外部浏览器；真实采样在实际内核集成测试中验证。
      input.environmentCheck?.onReport(syntheticEnvironmentReport(input))
      browserCalls.push("launch")
      launchInputs.push(input)
      launched.resolve()
      return {
        profileDir: join(dir, "browser-profiles", "acc-1"),
        pid: 1234,
        exited: new Promise<void>(() => undefined),
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
    exchangeCode: async (input: {
      dispatcher?: Dispatcher
      xrayRequest?: XrayHttpRequest
      redirectUri: string
    }) => {
      exchangeRedirectUris.push(input.redirectUri)
      exchangeDispatchers.push(input.dispatcher)
      exchangeXrayRequests.push(input.xrayRequest)
      return options.tokens ?? defaultTokens()
    },
    readProfile: async (input: { dispatcher?: Dispatcher; xrayRequest?: XrayHttpRequest }) => {
      profileDispatchers.push(input.dispatcher)
      profileXrayRequests.push(input.xrayRequest)
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
    nativeDiagnostics: options.nativeDiagnostics ?? {
      inspect: async (input) =>
        syntheticNativeEvidence(
          input.startedAt,
          input.proxyUrl === null ? "system" : "bound",
          input.expectedExitIp,
          { locale: input.fingerprint.lang, timezone: input.fingerprint.timezone },
        ),
      dispose: async () => undefined,
    },
    oauth: options.oauth ?? oauth,
    startProxyRuntime: options.proxyRuntimeUnavailable
      ? undefined
      : async (input) => {
          bridgeCalls.push(input)
          if (options.bridgeMissing) return null as unknown as ProxyRuntime
          return options.proxyRuntime ?? bridge
        },
    checkEgress: async (input) => {
      egressCalls.push({
        bridgeUrl: input.bridgeUrl,
        upstreamProxyUrl: input.upstreamProxyUrl,
        checkUrl: input.checkUrl,
      })
      if (options.bridgeUrlAfterEgress !== undefined) bridge.url = options.bridgeUrlAfterEgress
      if (options.checkEgressWait !== undefined) return options.checkEgressWait(input)
      return options.egress ?? { ok: true, ip: "1.1.1.1" }
    },
    ensureMembership: async () => {
      if (options.membershipError !== undefined) throw options.membershipError
      await options.membershipWait?.()
    },
    egressCheckUrl: "https://egress.test/trace",
    now: options.now ?? (() => now),
    id: options.id ?? (() => "acc-1"),
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
    exchangeXrayRequests,
    profileXrayRequests,
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
