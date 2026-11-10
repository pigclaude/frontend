// 负责在选号前刷新即将过期的 Claude 凭据；直连账号走系统网络，单飞、轮换并区分需要重新授权。

import type { AccountRecord, ClaudeCredential, LocalStore } from "@pigclaude/local-store"
import { createProxyAgent } from "@pigclaude/proxy-connection"
import type { ProxyAgent } from "undici"
import { ClaudeAccountError } from "./errors"
import {
  SubscriptionOAuthError,
  type ClaudeOAuthTokens,
  type SubscriptionOAuth,
} from "./subscription-oauth"

const defaultRefreshWindowMs = 2 * 60 * 1_000

/** 凭据刷新依赖。oauth 只使用 refresh，便于测试替换。 */
export type CredentialRefresherDeps = {
  store: Pick<LocalStore, "getProxy" | "updateAccount">
  oauth: Pick<SubscriptionOAuth, "refresh">
  now?: () => number
  refreshWindowMs?: number
}

/** 刷新账号凭据。保证同一账号并发刷新只发一次请求，invalid_grant 后标记需要重新授权。 */
export class CredentialRefresher {
  readonly #store: CredentialRefresherDeps["store"]
  readonly #oauth: Pick<SubscriptionOAuth, "refresh">
  readonly #now: () => number
  readonly #refreshWindowMs: number
  readonly #inflight = new Map<string, Promise<AccountRecord>>()

  /** 创建绑定到本机账号库和 OAuth 客户端的刷新器。 */
  constructor(deps: CredentialRefresherDeps) {
    this.#store = deps.store
    this.#oauth = deps.oauth
    this.#now = deps.now ?? Date.now
    this.#refreshWindowMs = deps.refreshWindowMs ?? defaultRefreshWindowMs
  }

  /** 距离到期不足刷新窗口时刷新，否则原样返回。凭据为空时明确失败。 */
  async refreshIfNeeded(account: AccountRecord): Promise<AccountRecord> {
    if (account.credential === null) {
      throw new ClaudeAccountError("CREDENTIAL_REFRESH_FAILED", "账号没有可用凭据")
    }
    if (account.credential.expiresAt - this.#now() > this.#refreshWindowMs) return account
    return this.refresh(account)
  }

  /** 刷新一次凭据。保证同一账号的并发调用共用同一个 Promise。 */
  async refresh(account: AccountRecord): Promise<AccountRecord> {
    const existing = this.#inflight.get(account.id)
    if (existing !== undefined) return existing
    const pending = this.#refresh(account).finally(() => {
      this.#inflight.delete(account.id)
    })
    this.#inflight.set(account.id, pending)
    return pending
  }

  async #refresh(account: AccountRecord): Promise<AccountRecord> {
    const credential = account.credential
    if (credential === null) {
      throw new ClaudeAccountError("CREDENTIAL_REFRESH_FAILED", "账号没有可用凭据")
    }
    const proxy = account.proxyId === null ? null : await this.#store.getProxy(account.proxyId)
    if (account.proxyId !== null && proxy === null) {
      throw new ClaudeAccountError("PROXY_UNAVAILABLE", "账号绑定的代理不存在")
    }
    let dispatcher: ProxyAgent | null = null
    if (proxy !== null) {
      try {
        dispatcher = createProxyAgent(proxy.url)
      } catch {
        throw new ClaudeAccountError("PROXY_INVALID", "账号绑定的代理地址无效")
      }
    }
    let tokens: ClaudeOAuthTokens
    try {
      tokens = await this.#oauth.refresh({
        refreshToken: credential.refreshToken,
        scopes: credential.scopes,
        ...(dispatcher === null ? {} : { dispatcher }),
      })
    } catch (error: unknown) {
      if (error instanceof SubscriptionOAuthError && error.invalidGrant) {
        await this.#store.updateAccount(account.id, (current) => {
          // 只处理仍是这次刷新所用 refresh token 的记录，避免清掉并发刷新写入的新凭据。
          if (current.credential?.refreshToken !== credential.refreshToken) return null
          return {
            ...current,
            credential: null,
            needsReauth: true,
            updatedAt: new Date(this.#now()).toISOString(),
          }
        })
        throw new ClaudeAccountError("CREDENTIAL_REFRESH_FAILED", "需要重新授权")
      }
      throw new ClaudeAccountError("CREDENTIAL_REFRESH_FAILED", "凭据刷新失败")
    } finally {
      await dispatcher?.close().catch(() => undefined)
    }
    const updatedCredential: ClaudeCredential = {
      ...credential,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      scopes: tokens.scopes,
    }
    const updated = await this.#store.updateAccount(account.id, (current) => {
      // 账号已删除或凭据已被其他刷新轮换时不复活旧记录。
      if (current.credential?.refreshToken !== credential.refreshToken) return null
      return {
        ...current,
        credential: { ...current.credential, ...updatedCredential },
        needsReauth: false,
        updatedAt: new Date(this.#now()).toISOString(),
      }
    })
    if (updated === null) {
      throw new ClaudeAccountError("STORAGE_FAILED", "保存刷新后的凭据失败")
    }
    return updated
  }
}
