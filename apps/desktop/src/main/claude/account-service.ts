// 负责编排 Claude 账号的添加、重新授权、更新和删除；不直接发 HTTP 或写文件。

import { randomUUID } from "node:crypto"
import type {
  ClaudeAccountEvent,
  ClaudeAccountErrorCode,
  ClaudeAccountView,
  ClaudeFingerprintView,
} from "@pigclaude/contracts/claude-account"
import type { AccountRecord, ClaudeCredential, LocalStore } from "@pigclaude/local-store"
import type { EgressResult } from "@pigclaude/login-gate/egress-check"
import { ProxyBridgeError, type ProxyBridge } from "@pigclaude/login-gate/proxy-bridge"
import { ProxyAgent } from "undici"
import {
  assertClaudeCliIdentity,
  buildClaudeCliAccountRecord,
  buildClaudeCliCredential,
  claudeCliDisplayName,
  claudeCliImportMessages,
  findClaudeCliAccount,
  mergeClaudeCliIdentity,
} from "./claude-cli-import"
import { readClaudeCliAccountMetadata, type ClaudeCliAccountMetadata } from "./cli-account-metadata"
import { readClaudeCliCredential, type ClaudeCliCredential } from "./cli-credential-reader"
import { ClaudeAccountError } from "./errors"
import { BrowserLaunchError, type FingerprintChromiumAdapter } from "./fingerprint-chromium"
import { ensureFingerprint } from "./fingerprint-args"
import {
  createSubscriptionOAuthRequest,
  SubscriptionOAuthError,
  type ClaudeOAuthProfile,
  type ClaudeOAuthTokens,
  type OAuthCallbackServer,
  type SubscriptionOAuth,
} from "./subscription-oauth"

const defaultEgressCheckUrl = "https://www.cloudflare.com/cdn-cgi/trace"
// 导入时 access token 至少还要有 60 秒有效期，避免刚导入就过期。
const cliImportExpiryMarginMs = 60_000

/** 添加或重新授权 Claude 账号的输入。proxyId 为 null 表示使用系统网络。 */
export type AuthorizeClaudeAccountInput = {
  accountId?: string
  displayName: string
  proxyId: string | null
  fingerprint: ClaudeFingerprintView
}

/** 修改账号设置的输入。proxyId 省略表示不变，null 表示解绑并使用系统网络。 */
export type UpdateClaudeAccountInput = {
  accountId: string
  displayName?: string
  enabled?: boolean
  proxyId?: string | null
  fingerprint?: ClaudeFingerprintView
}

/** 从 Claude CLI 导入账号的输入。confirmCopy 必须为 true，表示用户已确认复制凭据。 */
export type ImportClaudeCliAccountInput = {
  confirmCopy: boolean
  displayName?: string
}

/** 账号服务依赖。所有外部副作用都通过端口注入。 */
export type ClaudeAccountServiceDeps = {
  store: LocalStore
  browser: Pick<
    FingerprintChromiumAdapter,
    "ensureAvailable" | "launch" | "stop" | "deleteProfile" | "profileDir" | "stopAll"
  >
  oauth: Pick<
    SubscriptionOAuth,
    "buildAuthorizeUrl" | "startCallback" | "exchangeCode" | "readProfile"
  >
  startBridge: (input: { upstreamProxyUrl: string }) => Promise<ProxyBridge>
  checkEgress: (input: {
    bridgeUrl: string
    upstreamProxyUrl: string
    checkUrl: string
  }) => Promise<EgressResult>
  ensureMembership: () => Promise<void>
  /** 读取 Claude CLI Keychain 凭据；测试注入假实现，避免访问真实钥匙串。 */
  readCliCredential?: () => Promise<ClaudeCliCredential>
  /** 读取 Claude CLI 的 oauthAccount 元数据；返回 null 表示文件缺失或不可读。 */
  readCliAccountMetadata?: () => Promise<ClaudeCliAccountMetadata | null>
  egressCheckUrl?: string
  now?: () => number
  id?: () => string
  onEvent?: (event: ClaudeAccountEvent) => void
}

type ActiveAuthorization = {
  accountId: string
  callback: OAuthCallbackServer
}

/** Claude 账号服务。保证绑定代理时先核对出口；未绑定代理时直接使用系统网络，凭据只在全部成功后写入本机。 */
export class ClaudeAccountService {
  readonly #deps: ClaudeAccountServiceDeps
  readonly #now: () => number
  readonly #id: () => string
  readonly #egressCheckUrl: string
  readonly #readCliCredential: () => Promise<ClaudeCliCredential>
  readonly #readCliAccountMetadata: () => Promise<ClaudeCliAccountMetadata | null>
  #active: ActiveAuthorization | null = null

  /** 创建绑定到账号库、fingerprint-chromium、OAuth 和出口检查端口的服务。 */
  constructor(deps: ClaudeAccountServiceDeps) {
    this.#deps = deps
    this.#now = deps.now ?? Date.now
    this.#id = deps.id ?? randomUUID
    this.#egressCheckUrl = deps.egressCheckUrl ?? defaultEgressCheckUrl
    // v1 只读默认 Keychain 项和默认 ~/.claude.json，不跟随 CLAUDE_CONFIG_DIR 的多候选。
    this.#readCliCredential =
      deps.readCliCredential ?? (() => readClaudeCliCredential({ configDir: null }))
    this.#readCliAccountMetadata =
      deps.readCliAccountMetadata ?? (() => readClaudeCliAccountMetadata({ configDir: null }))
  }

  /** 返回脱敏账号列表。保证不包含 token。 */
  async list(): Promise<ClaudeAccountView[]> {
    const accounts = await this.#deps.store.listAccounts()
    return accounts.map(toView)
  }

  /** 添加或重新授权一个 Claude 账号。保证绑定代理时先核对出口；身份和存储全部通过后才保留凭据。 */
  async authorize(input: AuthorizeClaudeAccountInput): Promise<ClaudeAccountView> {
    const accountId = input.accountId ?? this.#id()
    this.#emit(accountId, "preparing")
    let bridge: ProxyBridge | null = null
    let callback: OAuthCallbackServer | null = null
    let browserLaunched = false
    try {
      await this.#ensureMembership()
      const displayName = input.displayName.trim()
      if (displayName === "") {
        throw new ClaudeAccountError("INVALID_INPUT", "账号名称不能为空")
      }
      const existing =
        input.accountId === undefined ? null : await this.#deps.store.getAccount(input.accountId)
      if (input.accountId !== undefined && existing === null) {
        throw new ClaudeAccountError("ACCOUNT_NOT_FOUND", "账号不存在")
      }
      const validation = ensureFingerprint(input.fingerprint, accountId)
      if (!validation.ok) {
        throw new ClaudeAccountError("FINGERPRINT_INVALID", validation.message)
      }
      const fingerprint = validation.fingerprint
      const proxy = input.proxyId === null ? null : await this.#deps.store.getProxy(input.proxyId)
      if (input.proxyId !== null && proxy === null) {
        throw new ClaudeAccountError("PROXY_INVALID", "代理不存在")
      }
      await this.#deps.browser.ensureAvailable()

      if (proxy !== null) {
        bridge = await this.#deps.startBridge({ upstreamProxyUrl: proxy.url })
        this.#emit(accountId, "checking-egress")
        const egress = await this.#deps.checkEgress({
          bridgeUrl: bridge.url,
          upstreamProxyUrl: proxy.url,
          checkUrl: this.#egressCheckUrl,
        })
        if (!egress.ok) {
          throw new ClaudeAccountError(
            egress.reason === "mismatch" ? "EGRESS_MISMATCH" : "EGRESS_CHECK_FAILED",
            "请勿登录",
          )
        }
      }

      const profileDir = this.#deps.browser.profileDir(accountId)

      this.#emit(accountId, "waiting-browser")
      const oauthRequest = createSubscriptionOAuthRequest()
      callback = await this.#deps.oauth.startCallback({ state: oauthRequest.state })
      const authorizeUrl = this.#deps.oauth.buildAuthorizeUrl({
        redirectUri: callback.redirectUri,
        state: oauthRequest.state,
        codeChallenge: oauthRequest.codeChallenge,
      })
      this.#active = { accountId, callback }
      await this.#deps.browser.launch({
        accountId,
        authorizeUrl,
        ...(bridge === null ? {} : { bridgeUrl: bridge.url }),
        fingerprint,
      })
      browserLaunched = true
      const code = await callback.waitForCode()
      this.#emit(accountId, "exchanging")

      const dispatcher = bridge === null ? null : new ProxyAgent(bridge.url)
      let tokens: ClaudeOAuthTokens
      let profile: ClaudeOAuthProfile | null
      try {
        tokens = await this.#deps.oauth.exchangeCode({
          code,
          state: oauthRequest.state,
          codeVerifier: oauthRequest.codeVerifier,
          redirectUri: callback.redirectUri,
          ...(dispatcher === null ? {} : { dispatcher }),
        })
        profile = await this.#deps.oauth.readProfile({
          accessToken: tokens.accessToken,
          ...(dispatcher === null ? {} : { dispatcher }),
        })
      } finally {
        await dispatcher?.close().catch(() => undefined)
      }

      assertSameAccount(existing, profile)
      const credential = buildCredential(tokens, profile, existing?.credential ?? null)
      const timestamp = new Date(this.#now()).toISOString()
      const record: AccountRecord = {
        schemaVersion: 3,
        id: accountId,
        displayName,
        enabled: existing?.enabled ?? true,
        credential,
        needsReauth: false,
        proxyId: input.proxyId,
        fingerprint,
        browserProfileDir: profileDir,
        exhaustedUntil: existing?.exhaustedUntil ?? null,
        createdAt: existing?.createdAt || timestamp,
        updatedAt: timestamp,
      }
      this.#emit(accountId, "saving")
      await this.#deps.store.saveAccount(record)
      this.#emit(accountId, "authorized")
      return toView(record)
    } catch (error: unknown) {
      const mapped = mapError(error)
      this.#emit(accountId, phaseFor(mapped.code), mapped.code, mapped.message)
      throw mapped
    } finally {
      this.#active = null
      await callback?.close().catch(() => undefined)
      if (browserLaunched) await this.#deps.browser.stop(accountId).catch(() => undefined)
      await bridge?.close().catch(() => undefined)
    }
  }

  /**
   * 从 Claude CLI 导入账号。保证只复制 OAuth 凭据，不写回或删除 CLI 凭据；
   * 命中已有账号时保留 id、指纹、代理、启用状态、冷却时间、创建时间和自定义名称。
   * 导入不发送授权阶段事件，避免驱动全局授权向导。
   */
  async importFromClaudeCli(input: ImportClaudeCliAccountInput): Promise<ClaudeAccountView> {
    if (input.confirmCopy !== true) {
      throw new ClaudeAccountError("INVALID_INPUT", claudeCliImportMessages.confirmCopy)
    }
    const newId = this.#id()
    try {
      await this.#ensureMembership()
      const cli = await this.#readCliCredential()
      const metadata = await this.#readCliAccountMetadata()
      if (
        !Number.isFinite(cli.expiresAt) ||
        cli.expiresAt <= this.#now() + cliImportExpiryMarginMs
      ) {
        throw new ClaudeAccountError("CLI_CREDENTIAL_EXPIRED", claudeCliImportMessages.expired)
      }
      const profile = await this.#readProfile(cli.accessToken)
      const identity = mergeClaudeCliIdentity(cli, metadata, profile)
      const existing = findClaudeCliAccount(await this.#deps.store.listAccounts(), identity)
      assertClaudeCliIdentity(existing, identity)
      const credential = buildClaudeCliCredential(cli, identity, existing?.credential ?? null)
      const displayName =
        existing !== null && input.displayName === undefined
          ? existing.displayName
          : claudeCliDisplayName(input.displayName ?? "", metadata, identity.email)
      const record = buildClaudeCliAccountRecord({
        existing,
        newId,
        displayName,
        credential,
        browserProfileDir: existing?.browserProfileDir ?? this.#deps.browser.profileDir(newId),
        now: new Date(this.#now()).toISOString(),
      })
      await this.#deps.store.saveAccount(record)
      return toView(record)
    } catch (error: unknown) {
      throw mapError(error)
    }
  }

  /** 取消正在等待的浏览器授权。保证授权 promise 以 cancelled 结束。 */
  async cancel(): Promise<void> {
    const active = this.#active
    if (active === null) return
    await active.callback.close()
  }

  /** 修改账号的显示名、启用状态、代理或指纹。保证不触碰凭据。 */
  async update(input: UpdateClaudeAccountInput): Promise<ClaudeAccountView> {
    const account = await this.#deps.store.getAccount(input.accountId)
    if (account === null) throw new ClaudeAccountError("ACCOUNT_NOT_FOUND", "账号不存在")
    let displayName = account.displayName
    if (input.displayName !== undefined) {
      displayName = input.displayName.trim()
      if (displayName === "") throw new ClaudeAccountError("INVALID_INPUT", "账号名称不能为空")
    }
    let proxyId = account.proxyId
    if (input.proxyId !== undefined) {
      if (input.proxyId === null) {
        proxyId = null
      } else {
        const proxy = await this.#deps.store.getProxy(input.proxyId)
        if (proxy === null) throw new ClaudeAccountError("PROXY_INVALID", "代理不存在")
        proxyId = input.proxyId
      }
    }
    let fingerprint = account.fingerprint
    if (input.fingerprint !== undefined) {
      const validation = ensureFingerprint(input.fingerprint, input.accountId)
      if (!validation.ok) throw new ClaudeAccountError("FINGERPRINT_INVALID", validation.message)
      fingerprint = validation.fingerprint
    }
    const updated: AccountRecord = {
      ...account,
      displayName,
      enabled: input.enabled ?? account.enabled,
      proxyId,
      fingerprint,
      updatedAt: new Date(this.#now()).toISOString(),
    }
    await this.#deps.store.saveAccount(updated)
    return toView(updated)
  }

  /** 删除账号。保证浏览器配置目录清理失败时保留本地账号。 */
  async remove(accountId: string): Promise<void> {
    const account = await this.#deps.store.getAccount(accountId)
    if (account === null) return
    try {
      await this.#deps.browser.deleteProfile(accountId)
    } catch (error: unknown) {
      throw mapError(error)
    }
    await this.#deps.store.removeAccount(accountId)
  }

  /** 取消活动授权并释放本机浏览器进程。 */
  async dispose(): Promise<void> {
    await this.cancel()
    await this.#deps.browser.stopAll()
  }

  /** 读取 profile 用于校正身份。保证失败时返回 null，不影响导入。 */
  async #readProfile(accessToken: string): Promise<ClaudeOAuthProfile | null> {
    try {
      return await this.#deps.oauth.readProfile({ accessToken })
    } catch {
      return null
    }
  }

  async #ensureMembership(): Promise<void> {
    try {
      await this.#deps.ensureMembership()
    } catch (error: unknown) {
      if (error instanceof ClaudeAccountError) throw error
      throw new ClaudeAccountError("MEMBERSHIP_REQUIRED", "会员校验不通过")
    }
  }

  #emit(
    accountId: string,
    phase: ClaudeAccountEvent["phase"],
    errorCode: ClaudeAccountErrorCode | null = null,
    message: string | null = null,
  ): void {
    this.#deps.onEvent?.({ accountId, phase, errorCode, message })
  }
}

function toView(account: AccountRecord): ClaudeAccountView {
  return {
    id: account.id,
    displayName: account.displayName,
    enabled: account.enabled,
    email: account.credential?.email ?? null,
    subscriptionType: account.credential?.subscriptionType ?? null,
    needsReauth: account.needsReauth,
    credentialExpiresAt: account.credential?.expiresAt ?? null,
    exhaustedUntil: account.exhaustedUntil,
    proxyId: account.proxyId,
    fingerprint: account.fingerprint,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  }
}

function buildCredential(
  tokens: { accessToken: string; refreshToken: string; expiresAt: number; scopes: string[] },
  profile: {
    accountUuid: string | null
    email: string | null
    organizationUuid: string | null
    subscriptionType: string | null
    rateLimitTier: string | null
  } | null,
  existing: ClaudeCredential | null,
): ClaudeCredential {
  return {
    schemaVersion: 1,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt,
    scopes: tokens.scopes,
    accountUuid: profile?.accountUuid ?? existing?.accountUuid ?? null,
    email: profile?.email ?? existing?.email ?? null,
    organizationUuid: profile?.organizationUuid ?? existing?.organizationUuid ?? null,
    subscriptionType: profile?.subscriptionType ?? existing?.subscriptionType ?? null,
    rateLimitTier: profile?.rateLimitTier ?? existing?.rateLimitTier ?? null,
  }
}

function assertSameAccount(
  existing: AccountRecord | null,
  profile: {
    accountUuid: string | null
    email: string | null
  } | null,
): void {
  if (existing === null || profile === null) return
  const previous = existing.credential
  if (previous === null) return
  if (
    previous.accountUuid !== null &&
    profile.accountUuid !== null &&
    previous.accountUuid !== profile.accountUuid
  ) {
    throw new ClaudeAccountError("ACCOUNT_MISMATCH", "登录的是另一个 Claude 账号")
  }
  if (
    previous.accountUuid === null &&
    previous.email !== null &&
    profile.email !== null &&
    previous.email !== profile.email
  ) {
    throw new ClaudeAccountError("ACCOUNT_MISMATCH", "登录的是另一个 Claude 账号")
  }
}

function mapError(error: unknown): ClaudeAccountError {
  if (error instanceof ClaudeAccountError) return error
  if (error instanceof BrowserLaunchError) {
    return new ClaudeAccountError(error.code, error.message)
  }
  if (error instanceof SubscriptionOAuthError) {
    return new ClaudeAccountError(error.code, error.message)
  }
  if (error instanceof ProxyBridgeError) {
    return new ClaudeAccountError(
      error.code === "UNSUPPORTED_PROXY_SCHEME" ? "UNSUPPORTED_PROXY_SCHEME" : "PROXY_INVALID",
      error.message,
    )
  }
  return new ClaudeAccountError("UNEXPECTED_ERROR", "Claude 账号操作失败")
}

function phaseFor(code: ClaudeAccountErrorCode): ClaudeAccountEvent["phase"] {
  if (code === "AUTHORIZATION_CANCELLED") return "cancelled"
  if (
    code === "EGRESS_MISMATCH" ||
    code === "EGRESS_CHECK_FAILED" ||
    code === "PROXY_UNAVAILABLE" ||
    code === "PROXY_INVALID" ||
    code === "UNSUPPORTED_PROXY_SCHEME" ||
    code.startsWith("BROWSER_")
  ) {
    return "blocked"
  }
  return "failed"
}
