// 保证浏览器退出后才释放本次授权回调和 Xray，并保留失败资源以供重试。

import type { ProxyRuntime } from "@pigclaude/login-gate/proxy-runtime"
import { mapError } from "./account-service-errors"
import type { ClaudeAccountError } from "./errors"
import type { LaunchedBrowser } from "./fingerprint-chromium"
import type { OAuthCallbackServer } from "./subscription-oauth"

/** 单次授权持有的浏览器、回调和代理资源。 */
export type AuthorizationResources = {
  browser: LaunchedBrowser | null
  callback: OAuthCallbackServer | null
  proxy: ProxyRuntime | null
  releaseProfile?: () => void
  nativeCleanup?: () => Promise<void>
}

/** 跟踪未能回收的授权资源，阻止新授权越过清理边界。 */
export class AuthorizationResourceCleanup {
  readonly #pending = new Map<string, Set<AuthorizationResources>>()
  readonly #inFlight = new WeakMap<AuthorizationResources, Promise<ClaudeAccountError | null>>()

  /** 返回是否仍有资源需要重试回收。 */
  get hasPending(): boolean {
    return this.#pending.size !== 0
  }

  /** 先停止浏览器，再释放回调与代理；失败时保留未完成资源。 */
  async close(
    accountId: string,
    resources: AuthorizationResources,
  ): Promise<ClaudeAccountError | null> {
    const existing = this.#inFlight.get(resources)
    if (existing !== undefined) return existing
    const work = this.#close(accountId, resources)
    this.#inFlight.set(resources, work)
    try {
      return await work
    } finally {
      if (this.#inFlight.get(resources) === work) this.#inFlight.delete(resources)
    }
  }

  async #close(
    accountId: string,
    resources: AuthorizationResources,
  ): Promise<ClaudeAccountError | null> {
    if (
      resources.browser !== null ||
      resources.callback !== null ||
      resources.proxy !== null ||
      resources.releaseProfile ||
      resources.nativeCleanup
    ) {
      this.#remember(accountId, resources)
    }
    try {
      await resources.browser?.stop()
      resources.browser = null
    } catch (error: unknown) {
      this.#remember(accountId, resources)
      return mapError(error)
    }
    const results = await Promise.allSettled([
      resources.callback?.close(),
      resources.proxy?.close(),
      resources.nativeCleanup?.(),
    ])
    if (results[0]?.status === "fulfilled") resources.callback = null
    if (results[1]?.status === "fulfilled") resources.proxy = null
    if (results[2]?.status === "fulfilled") resources.nativeCleanup = undefined
    const failure = results.find((result) => result.status === "rejected")
    if (failure?.status === "rejected") {
      this.#remember(accountId, resources)
      return mapError(failure.reason)
    }
    resources.releaseProfile?.()
    resources.releaseProfile = undefined
    const pending = this.#pending.get(accountId)
    pending?.delete(resources)
    if (!pending?.size) this.#pending.delete(accountId)
    return null
  }

  /** 逐个重试未释放的资源；失败时保留记录并报告错误。 */
  async retry(): Promise<void> {
    for (const [accountId, resources] of [...this.#pending.entries()].reverse()) {
      for (const item of [...resources].reverse()) {
        const error = await this.close(accountId, item)
        if (error !== null) throw error
      }
    }
  }

  /** 删除账号前完成该账号仍在等待的资源回收。 */
  async retryAccount(accountId: string): Promise<void> {
    const resources = this.#pending.get(accountId)
    if (resources === undefined) return
    for (const item of [...resources].reverse()) {
      const error = await this.close(accountId, item)
      if (error !== null) throw error
    }
  }

  #remember(accountId: string, resources: AuthorizationResources): void {
    const pending = this.#pending.get(accountId) ?? new Set<AuthorizationResources>()
    pending.add(resources)
    this.#pending.set(accountId, pending)
  }
}
