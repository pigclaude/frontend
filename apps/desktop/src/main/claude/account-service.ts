// 负责编排 Claude 账号的添加、重新授权、更新和删除；不直接发 HTTP 或写文件。

import { randomUUID } from "node:crypto"
import { isDeepStrictEqual } from "node:util"
import type {
  ClaudeAccountEvent,
  ClaudeAccountErrorCode,
  ClaudeAccountView,
} from "@pigclaude/contracts/claude-account"
import type { AccountRecord } from "@pigclaude/local-store"
import type { ProxyRuntime } from "@pigclaude/login-gate/proxy-runtime"
import { createXrayHttpClient } from "@pigclaude/login-gate/xray-http"
import { importClaudeCliAccount } from "./account-service-cli-import"
import { updateClaudeAccount } from "./account-service-update"
import { AuthorizationLifecycle, type AuthorizationAttempt } from "./authorization-lifecycle"
import { AuthorizationResourceCleanup } from "./account-service-cleanup"
import {
  launchAndWaitForCallback,
  waitForProxyReady,
  watchProxyFailure,
} from "./account-service-proxy-callback"
import { mapError, phaseFor, requireMembership } from "./account-service-errors"
import type { ClaudeAccountServiceDeps } from "./account-service-deps"
import { createAuthorizationEnvironmentCheck } from "./account-service-environment"
import { accountBrowserProfile } from "./account-browser-profile"
import { BrowserProfileUsage } from "./browser-profile-usage"
/** 保留账号服务既有依赖类型入口。 */
export type { ClaudeAccountServiceDeps } from "./account-service-deps"

import type {
  AuthorizeClaudeAccountInput,
  ImportClaudeCliAccountInput,
  UpdateClaudeAccountInput,
} from "./account-service-inputs"
export type {
  AuthorizeClaudeAccountInput,
  ImportClaudeCliAccountInput,
  UpdateClaudeAccountInput,
} from "./account-service-inputs"
import { assertSameAccount, buildCredential, toView } from "./account-service-record"
import { ClaudeAccountError } from "./errors"
import { BrowserStartupCleanupError, type LaunchedBrowser } from "./fingerprint-chromium"
import { ensureFingerprint } from "./fingerprint-args"
import { isValidBridgeUrl, launchArgumentConflict } from "./launch-argument-guard"
import {
  createSubscriptionOAuthRequest,
  type ClaudeOAuthProfile,
  type ClaudeOAuthTokens,
  type OAuthCallbackServer,
} from "./subscription-oauth"
import { defaultEnvironmentExitUrl } from "./environment-targets"
const defaultEgressCheckUrl = defaultEnvironmentExitUrl

/** Claude 账号服务。保证绑定代理时先核对出口；未绑定代理时直接使用系统网络，凭据只在全部成功后写入本机。 */
export class ClaudeAccountService {
  readonly #deps: ClaudeAccountServiceDeps
  readonly #now: () => number
  readonly #id: () => string
  readonly #egressCheckUrl: string
  readonly #authorizations = new AuthorizationLifecycle()
  readonly #pendingCleanup = new AuthorizationResourceCleanup()

  /** 创建绑定到账号库、fingerprint-chromium、OAuth 和出口检查端口的服务。 */
  constructor(deps: ClaudeAccountServiceDeps) {
    this.#deps = { ...deps, profileUsage: deps.profileUsage ?? new BrowserProfileUsage() }
    this.#now = deps.now ?? Date.now
    this.#id = deps.id ?? randomUUID
    this.#egressCheckUrl = deps.egressCheckUrl ?? defaultEgressCheckUrl
  }

  /** 返回脱敏账号列表。保证不包含 token。 */
  async list(): Promise<ClaudeAccountView[]> {
    const accounts = await this.#deps.store.listAccounts()
    return accounts.map(toView)
  }

  /** 添加或重新授权一个 Claude 账号。保证绑定代理时先核对出口；身份和存储全部通过后才保留凭据。 */
  async authorize(input: AuthorizeClaudeAccountInput): Promise<ClaudeAccountView> {
    input = structuredClone(input)
    const requestedAccountId = input.accountId
    const accountId = requestedAccountId ?? this.#id()
    if (input.browserProfileId === undefined) {
      const legacy = ensureFingerprint(input.fingerprint, accountId)
      if (!legacy.ok) throw new ClaudeAccountError("FINGERPRINT_INVALID", legacy.message)
      const conflict = launchArgumentConflict(
        legacy.fingerprint.unknownArgs ?? [],
        input.proxyId !== null,
        undefined,
        legacy.fingerprint.webrtcPolicy,
      )
      if (conflict) throw new ClaudeAccountError("FINGERPRINT_INVALID", conflict)
    }
    let proxyRuntime: ProxyRuntime | null = null
    let bridgeUrl: string | null = null
    let expectedExitIp: string | null = null
    let callback: OAuthCallbackServer | null = null
    let launched: LaunchedBrowser | null = null
    let attempt: AuthorizationAttempt | null = null
    const proxyFailure = new AbortController()
    let failure: ClaudeAccountError | null = null
    let committed = false
    let releaseProfile: (() => void) | undefined
    let nativeStarted = false
    const assertCanSpawn = () => {
      if (this.#pendingCleanup.hasPending) {
        throw new ClaudeAccountError("BROWSER_STOP_FAILED", "浏览器或授权资源尚未关闭，请稍后重试")
      }
      proxyRuntime?.assertRunning?.()
    }
    try {
      assertCanSpawn()
      attempt = this.#authorizations.begin(accountId)
      const authorizationSignal = AbortSignal.any([attempt.signal, proxyFailure.signal])
      if (this.#authorizations.canEmit(attempt)) this.#emit(accountId, "preparing")
      const selected = await accountBrowserProfile(this.#deps.store, input, accountId, {
        usage: this.#deps.profileUsage,
        systemLocale: this.#deps.systemLocale,
        systemTimezone: this.#deps.systemTimezone,
      })
      releaseProfile = selected.release
      const proxyId = selected.proxyId
      const validation = ensureFingerprint(
        selected.fingerprint,
        selected.browserProfileId ?? accountId,
      )
      const displayName = input.displayName.trim()
      await requireMembership(() => this.#deps.ensureMembership())
      attempt.checkpoint()
      if (displayName === "") throw new ClaudeAccountError("INVALID_INPUT", "账号名称不能为空")
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
      const conflict = launchArgumentConflict(
        fingerprint.unknownArgs ?? [],
        proxyId !== null,
        undefined,
        fingerprint.webrtcPolicy,
      )
      if (conflict !== null) throw new ClaudeAccountError("FINGERPRINT_INVALID", conflict)
      const proxy = selected.proxy
      attempt.checkpoint()
      if (proxyId !== null && proxy === null) {
        throw new ClaudeAccountError("PROXY_INVALID", "代理不存在")
      }
      await this.#deps.browser.ensureAvailable()
      attempt.claim()
      if (proxy !== null) {
        const startProxyRuntime = this.#deps.startProxyRuntime
        if (startProxyRuntime === undefined) {
          throw new ClaudeAccountError("PROXY_UNAVAILABLE", "Xray 代理尚未接入，请勿登录")
        }
        proxyRuntime = await startProxyRuntime({ upstreamProxyUrl: proxy.url })
        watchProxyFailure(proxyRuntime, proxyFailure, () => callback)
        attempt.checkpoint()
        const startedBridgeUrl = proxyRuntime?.url
        if (!isValidBridgeUrl(startedBridgeUrl)) {
          throw new ClaudeAccountError("PROXY_UNAVAILABLE", "本机代理入口不可用，请勿登录")
        }
        bridgeUrl = startedBridgeUrl
        this.#emit(accountId, "checking-egress")
        const egress = await this.#deps.checkEgress({
          bridgeUrl,
          upstreamProxyUrl: proxy.url,
          checkUrl: this.#egressCheckUrl,
          signal: authorizationSignal,
        })
        attempt.checkpoint()
        await waitForProxyReady(proxyRuntime, authorizationSignal)
        if (egress.ok) expectedExitIp = egress.ip
        if (!egress.ok) {
          throw new ClaudeAccountError(
            egress.reason === "mismatch" ? "EGRESS_MISMATCH" : "EGRESS_CHECK_FAILED",
            "请勿登录",
          )
        }
      }
      const profileDir = this.#deps.browser.profileDir(selected.browserDataId)
      this.#emit(accountId, "waiting-browser")
      const oauthRequest = createSubscriptionOAuthRequest()
      callback = await this.#deps.oauth.startCallback({ state: oauthRequest.state })
      if (authorizationSignal.aborted) callback.cancel()
      attempt.attach(callback)
      authorizationSignal.throwIfAborted()
      const callbackUri = callback.redirectUri
      const authorizeUrl = this.#deps.oauth.buildAuthorizeUrl({
        redirectUri: callbackUri,
        state: oauthRequest.state,
        codeChallenge: oauthRequest.codeChallenge,
      })
      await waitForProxyReady(proxyRuntime, authorizationSignal)
      const network =
        proxyId === null
          ? { mode: "system" as const }
          : { mode: "bound" as const, bridgeUrl: bridgeUrl ?? "", callbackUri }
      nativeStarted = true
      const environment = await createAuthorizationEnvironmentCheck(
        {
          accountId,
          fingerprint,
          network,
          expectedExitIp,
          browserProfile: { id: selected.browserProfileId, revision: selected.revision },
          proxyUrl: proxy?.url ?? null,
          signal: authorizationSignal,
        },
        this.#now,
        this.#deps.nativeDiagnostics,
      )
      const activeAttempt = attempt
      const code = await launchAndWaitForCallback({
        callback,
        runtime: proxyRuntime,
        signal: authorizationSignal,
        checkpoint: () => activeAttempt.checkpoint(),
        onLaunched: (browser) => {
          launched = browser
        },
        launch: (signal, assertCanNavigate) =>
          this.#deps.browser.launch({
            accountId,
            browserProfileId: selected.browserProfileId,
            browserDataId: selected.browserDataId,
            authorizeUrl,
            network,
            environmentCheck: environment.request,
            fingerprint,
            signal,
            assertCanSpawn,
            assertCanNavigate,
          }),
      })
      attempt.checkpoint()
      await waitForProxyReady(proxyRuntime, authorizationSignal)
      environment.assertApproved()
      await selected.assertCurrent()
      this.#emit(accountId, "exchanging")

      const xrayClient = proxy === null ? null : createXrayHttpClient(bridgeUrl ?? "")
      let tokens: ClaudeOAuthTokens
      let profile: ClaudeOAuthProfile | null
      try {
        tokens = await this.#deps.oauth.exchangeCode({
          code,
          state: oauthRequest.state,
          codeVerifier: oauthRequest.codeVerifier,
          redirectUri: callbackUri,
          signal: authorizationSignal,
          ...(xrayClient === null ? {} : { xrayRequest: xrayClient.request }),
        })
        attempt.checkpoint()
        await waitForProxyReady(proxyRuntime, authorizationSignal)
        profile = await this.#deps.oauth.readProfile({
          accessToken: tokens.accessToken,
          signal: authorizationSignal,
          ...(xrayClient === null ? {} : { xrayRequest: xrayClient.request }),
        })
        await waitForProxyReady(proxyRuntime, authorizationSignal)
      } finally {
        xrayClient?.close()
      }
      attempt.checkpoint()
      assertSameAccount(existing, profile)
      await selected.assertCurrent()
      const credential = buildCredential(tokens, profile, existing?.credential ?? null)
      const timestamp = new Date(this.#now()).toISOString()
      const record: AccountRecord = {
        schemaVersion: 3,
        id: accountId,
        ...(selected.browserProfileId ? { browserProfileId: selected.browserProfileId } : {}),
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
            current.browserProfileId !== selected.browserProfileId ||
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
      if (error instanceof BrowserStartupCleanupError) launched = error.browser
      failure = mapError(
        attempt?.signal.aborted
          ? attempt.signal.reason
          : proxyFailure.signal.aborted
            ? proxyFailure.signal.reason
            : error,
      )
      throw failure
    } finally {
      const stopError = await this.#pendingCleanup.close(accountId, {
        browser: launched,
        callback,
        proxy: proxyRuntime,
        releaseProfile,
        nativeCleanup: nativeStarted
          ? () => this.#deps.nativeDiagnostics?.settle?.() ?? Promise.resolve()
          : undefined,
      })
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
    return importClaudeCliAccount(this.#deps, input, { now: this.#now, id: this.#id })
  }

  /** 取消并等待当前授权清理；提交已开始或浏览器未退出时返回明确错误。 */
  async cancel(): Promise<void> {
    await this.#authorizations.cancelCurrent()
    await this.#deps.nativeDiagnostics?.settle?.()
    await this.#pendingCleanup.retry()
  }

  /** 修改账号的显示名、启用状态、代理或指纹。保证不触碰凭据。 */
  async update(input: UpdateClaudeAccountInput): Promise<ClaudeAccountView> {
    return updateClaudeAccount(this.#deps, input, this.#now)
  }

  /** 删除账号。保证浏览器配置目录清理失败时保留本地账号。 */
  async remove(accountId: string): Promise<void> {
    await this.#authorizations.remove(accountId, async () => {
      await this.#pendingCleanup.retryAccount(accountId)
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
    const native = this.#deps.nativeDiagnostics?.dispose()
    const results = await Promise.allSettled([browser, authorizations, native])
    if (results.some((result) => result.status === "rejected")) {
      throw new ClaudeAccountError("BROWSER_STOP_FAILED", "无法确认浏览器已退出，请手动关闭后重试")
    }
    await this.#pendingCleanup.retry()
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
