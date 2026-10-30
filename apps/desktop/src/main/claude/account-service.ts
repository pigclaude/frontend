// 负责编排 Claude 账号的添加、重新授权、更新和删除；不直接发 HTTP 或写文件。

import { randomUUID } from "node:crypto"
import { isDeepStrictEqual } from "node:util"
import type {
  ClaudeAccountEvent,
  ClaudeAccountErrorCode,
  ClaudeAccountView,
  ClaudeFingerprintView,
} from "@pigclaude/contracts/claude-account"
import type { AccountRecord, LocalStore } from "@pigclaude/local-store"
import type { EgressResult } from "@pigclaude/login-gate/egress-check"
import type { ProxyBridge } from "@pigclaude/login-gate/proxy-bridge"
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
import { AuthorizationLifecycle, type AuthorizationAttempt } from "./authorization-lifecycle"
import { mapError, phaseFor } from "./account-service-errors"
import { assertSameAccount, buildCredential, toView } from "./account-service-record"
import { ClaudeAccountError } from "./errors"
import type { FingerprintChromiumAdapter, LaunchedBrowser } from "./fingerprint-chromium"
import { ensureFingerprint } from "./fingerprint-args"
import { isValidBridgeUrl, launchArgumentConflict } from "./launch-argument-guard"
import {
  createSubscriptionOAuthRequest,
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
    | "ensureAvailable"
    | "ensureBoundProxyProtection"
    | "launch"
    | "deleteProfile"
    | "profileDir"
    | "dispose"
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

/** Claude 账号服务。保证绑定代理时先核对出口；未绑定代理时直接使用系统网络，凭据只在全部成功后写入本机。 */
export class ClaudeAccountService {
  readonly #deps: ClaudeAccountServiceDeps
  readonly #now: () => number
  readonly #id: () => string
  readonly #egressCheckUrl: string
  readonly #readCliCredential: () => Promise<ClaudeCliCredential>
  readonly #readCliAccountMetadata: () => Promise<ClaudeCliAccountMetadata | null>
  readonly #authorizations = new AuthorizationLifecycle()
  readonly #pendingCleanup = new Map<string, LaunchedBrowser>()

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
    const requestedAccountId = input.accountId
    const accountId = requestedAccountId ?? this.#id()
    const proxyId = input.proxyId
    let bridge: ProxyBridge | null = null
    let bridgeUrl: string | null = null
    let callback: OAuthCallbackServer | null = null
    let launched: LaunchedBrowser | null = null
    let attempt: AuthorizationAttempt | null = null
    let failure: ClaudeAccountError | null = null
    let committed = false
    const assertCanSpawn = () => {
      if (this.#pendingCleanup.size !== 0) {
        throw new ClaudeAccountError("BROWSER_STOP_FAILED", "请先关闭仍在运行的浏览器并重试取消")
      }
    }
    try {
      assertCanSpawn()
      attempt = this.#authorizations.begin(accountId)
      if (this.#authorizations.canEmit(attempt)) this.#emit(accountId, "preparing")
      const validation = ensureFingerprint(input.fingerprint, accountId)
      const displayName = input.displayName.trim()
      await this.#ensureMembership()
      attempt.checkpoint()
      if (displayName === "") {
        throw new ClaudeAccountError("INVALID_INPUT", "账号名称不能为空")
      }
      const existing =
        requestedAccountId === undefined
          ? null
          : await this.#deps.store.getAccount(requestedAccountId)
      attempt.checkpoint()
      if (requestedAccountId !== undefined && existing === null) {
        throw new ClaudeAccountError("ACCOUNT_NOT_FOUND", "账号不存在")
      }
      if (!validation.ok) {
        throw new ClaudeAccountError("FINGERPRINT_INVALID", validation.message)
      }
      const fingerprint = validation.fingerprint
      const conflict = launchArgumentConflict(fingerprint.unknownArgs ?? [], proxyId !== null)
      if (conflict !== null) throw new ClaudeAccountError("FINGERPRINT_INVALID", conflict)
      const proxy = proxyId === null ? null : await this.#deps.store.getProxy(proxyId)
      attempt.checkpoint()
      if (proxyId !== null && proxy === null) {
        throw new ClaudeAccountError("PROXY_INVALID", "代理不存在")
      }
      if (proxy !== null) this.#deps.browser.ensureBoundProxyProtection()
      await this.#deps.browser.ensureAvailable()
      attempt.claim()

      if (proxy !== null) {
        bridge = await this.#deps.startBridge({ upstreamProxyUrl: proxy.url })
        attempt.checkpoint()
        const startedBridgeUrl = bridge?.url
        if (!isValidBridgeUrl(startedBridgeUrl)) {
          throw new ClaudeAccountError("PROXY_UNAVAILABLE", "代理桥不可用，请勿登录")
        }
        bridgeUrl = startedBridgeUrl
        this.#emit(accountId, "checking-egress")
        const egress = await this.#deps.checkEgress({
          bridgeUrl,
          upstreamProxyUrl: proxy.url,
          checkUrl: this.#egressCheckUrl,
        })
        attempt.checkpoint()
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
      attempt.attach(callback)
      const callbackUri = callback.redirectUri
      const authorizeUrl = this.#deps.oauth.buildAuthorizeUrl({
        redirectUri: callbackUri,
        state: oauthRequest.state,
        codeChallenge: oauthRequest.codeChallenge,
      })
      launched = await this.#deps.browser.launch({
        accountId,
        authorizeUrl,
        network:
          proxyId === null
            ? { mode: "system" }
            : { mode: "bound", bridgeUrl: bridgeUrl ?? "", callbackUri },
        fingerprint,
        signal: attempt.signal,
        assertCanSpawn,
      })
      attempt.checkpoint()
      const code = await callback.waitForCode()
      attempt.checkpoint()
      this.#emit(accountId, "exchanging")

      const dispatcher = bridgeUrl === null ? null : new ProxyAgent(bridgeUrl)
      let tokens: ClaudeOAuthTokens
      let profile: ClaudeOAuthProfile | null
      try {
        tokens = await this.#deps.oauth.exchangeCode({
          code,
          state: oauthRequest.state,
          codeVerifier: oauthRequest.codeVerifier,
          redirectUri: callbackUri,
          ...(dispatcher === null ? {} : { dispatcher }),
        })
        attempt.checkpoint()
        profile = await this.#deps.oauth.readProfile({
          accessToken: tokens.accessToken,
          ...(dispatcher === null ? {} : { dispatcher }),
        })
      } finally {
        await dispatcher?.close().catch(() => undefined)
      }

      attempt.checkpoint()
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
        proxyId,
        fingerprint,
        browserProfileDir: profileDir,
        exhaustedUntil: existing?.exhaustedUntil ?? null,
        createdAt: existing?.createdAt || timestamp,
        updatedAt: timestamp,
      }
      this.#emit(accountId, "saving")
      attempt.beginCommit()
      if (existing === null) {
        await this.#deps.store.saveAccount(record)
      } else {
        const updated = await this.#deps.store.updateAccount(accountId, (current) => {
          assertSameAccount(current, profile)
          if (!isDeepStrictEqual(current.credential, existing.credential)) {
            throw new ClaudeAccountError("INVALID_INPUT", "账号凭据已更新，请重新授权")
          }
          if (
            current.proxyId !== existing.proxyId ||
            !isDeepStrictEqual(current.fingerprint, existing.fingerprint)
          ) {
            throw new ClaudeAccountError("INVALID_INPUT", "代理或指纹已变更，请重新授权")
          }
          return {
            ...current,
            displayName:
              current.displayName === existing.displayName ? displayName : current.displayName,
            proxyId: current.proxyId === existing.proxyId ? proxyId : current.proxyId,
            fingerprint: isDeepStrictEqual(current.fingerprint, existing.fingerprint)
              ? fingerprint
              : current.fingerprint,
            browserProfileDir:
              current.browserProfileDir === existing.browserProfileDir
                ? profileDir
                : current.browserProfileDir,
            credential: buildCredential(tokens, profile, current.credential),
            needsReauth: false,
            updatedAt: timestamp,
          }
        })
        if (updated === null) throw new ClaudeAccountError("ACCOUNT_NOT_FOUND", "账号不存在")
        Object.assign(record, updated)
      }
      committed = true
      return toView(record)
    } catch (error: unknown) {
      failure = mapError(error)
      throw failure
    } finally {
      await callback?.close().catch(() => undefined)
      let stopError: ClaudeAccountError | null = null
      try {
        await launched?.stop()
      } catch (error: unknown) {
        stopError = mapError(error)
        if (launched !== null) this.#pendingCleanup.set(accountId, launched)
      }
      await bridge?.close().catch(() => undefined)
      const canEmit = attempt === null || this.#authorizations.canEmit(attempt)
      attempt?.finish(stopError)
      if (stopError !== null && !committed) {
        const combined =
          failure === null
            ? stopError
            : new ClaudeAccountError(failure.code, `${failure.message}；${stopError.message}`)
        if (canEmit) this.#emit(accountId, "blocked", stopError.code, combined.message)
        throw combined
      }
      if (failure !== null && canEmit) {
        this.#emit(accountId, phaseFor(failure.code), failure.code, failure.message)
      }
      if (committed) {
        this.#emit(accountId, "authorized", stopError?.code ?? null, stopError?.message ?? null)
      }
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
      const makeRecord = (current: AccountRecord | null): AccountRecord => {
        assertClaudeCliIdentity(current, identity)
        const displayName =
          current !== null && input.displayName === undefined
            ? current.displayName
            : claudeCliDisplayName(input.displayName ?? "", metadata, identity.email)
        return buildClaudeCliAccountRecord({
          existing: current,
          newId,
          displayName,
          credential: buildClaudeCliCredential(cli, identity, current?.credential ?? null),
          browserProfileDir: current?.browserProfileDir ?? this.#deps.browser.profileDir(newId),
          now: new Date(this.#now()).toISOString(),
        })
      }
      if (existing === null) {
        const record = makeRecord(null)
        await this.#deps.store.saveAccount(record)
        return toView(record)
      }
      const updated = await this.#deps.store.updateAccount(existing.id, (current) => {
        if (!isDeepStrictEqual(current.credential, existing.credential)) {
          throw new ClaudeAccountError("INVALID_INPUT", "账号凭据已更新，请重新导入")
        }
        return makeRecord(current)
      })
      if (updated === null) throw new ClaudeAccountError("ACCOUNT_NOT_FOUND", "账号不存在")
      return toView(updated)
    } catch (error: unknown) {
      throw mapError(error)
    }
  }

  /** 取消并等待当前授权清理；提交已开始或浏览器未退出时返回明确错误。 */
  async cancel(): Promise<void> {
    await this.#authorizations.cancelCurrent()
    for (const [accountId, launched] of [...this.#pendingCleanup.entries()].reverse()) {
      try {
        await launched.stop()
      } catch (error: unknown) {
        throw mapError(error)
      }
      if (this.#pendingCleanup.get(accountId) === launched) this.#pendingCleanup.delete(accountId)
    }
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
    const updated = await this.#deps.store.updateAccount(input.accountId, (current) => ({
      ...current,
      displayName: input.displayName === undefined ? current.displayName : displayName,
      enabled: input.enabled ?? current.enabled,
      proxyId: input.proxyId === undefined ? current.proxyId : proxyId,
      fingerprint: input.fingerprint === undefined ? current.fingerprint : fingerprint,
      updatedAt: new Date(this.#now()).toISOString(),
    }))
    if (updated === null) throw new ClaudeAccountError("ACCOUNT_NOT_FOUND", "账号不存在")
    return toView(updated)
  }

  /** 删除账号。保证浏览器配置目录清理失败时保留本地账号。 */
  async remove(accountId: string): Promise<void> {
    await this.#authorizations.remove(accountId, async () => {
      const account = await this.#deps.store.getAccount(accountId)
      if (account === null) return
      try {
        await this.#deps.browser.deleteProfile(accountId)
      } catch (error: unknown) {
        throw mapError(error)
      }
      await this.#deps.store.removeAccount(accountId)
    })
  }

  /** 取消活动授权并释放本机浏览器进程。 */
  async dispose(): Promise<void> {
    const browser = this.#deps.browser.dispose()
    const authorizations = this.#authorizations.dispose()
    const results = await Promise.allSettled([browser, authorizations])
    if (results.some((result) => result.status === "rejected")) {
      throw new ClaudeAccountError("BROWSER_STOP_FAILED", "无法确认浏览器已退出，请手动关闭后重试")
    }
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
