// 把一个会话的 CLI 环境与 daemon 为它实际选的号关联，兼容换号保持原环境，不兼容时不转发请求。
// 每个会话一份；不同会话可以同时绑定不同的语言和时区。

import { randomUUID } from "node:crypto"
import type { LocalStore } from "@pigclaude/local-store"
import { AccountEnvironmentMismatchError } from "@pigclaude/daemon"
import type { ProfileEnvironment } from "../session/profile-environment"
import { profileEnvironmentKey, sameProfileEnvironment } from "../session/profile-environment"
import { BrowserProfileUsage } from "../claude/browser-profile-usage"
import type { AccountChooser, ChooseAccountInput, ChosenAccount } from "./account-chooser"

type Binding = { token: string; environment: ProfileEnvironment; leases: Map<string, () => void> }

/** 一个会话只保留一个 CLI 环境，所有兼容账号读取同一版本规则；会话关闭后拒绝新的绑定。 */
export class SessionAccountEnvironment {
  readonly #store: Pick<LocalStore, "getAccount" | "getProxy">
  readonly #usage: BrowserProfileUsage
  #binding: Binding | null = null
  #closed = false

  /** 接收真实账号读取视图和共享配置使用权。 */
  constructor(store: Pick<LocalStore, "getAccount" | "getProxy">, usage: BrowserProfileUsage) {
    this.#store = store
    this.#usage = usage
  }

  /** 在 CLI 启动前固定环境；返回幂等释放，不允许同一会话覆盖在途绑定。 */
  async bind(environment: ProfileEnvironment): Promise<() => void> {
    if (this.#closed) throw new Error("SESSION_START_FAILED: 会话已结束")
    if (this.#binding) throw new Error("SESSION_ALREADY_ACTIVE: 已有 CLI 环境正在使用")
    if (!profileEnvironmentKey(environment))
      throw new Error("SESSION_START_FAILED: 实例语言或时区不可用")
    const binding: Binding = {
      token: randomUUID(),
      environment: structuredClone(environment),
      leases: new Map(),
    }
    if (environment.browserProfileId)
      this.#hold(binding, environment.browserProfileId, environment.accountId)
    this.#binding = binding
    const release = () => {
      if (this.#binding !== binding) return
      this.#binding = null
      for (const release of binding.leases.values()) release()
      binding.leases.clear()
    }
    try {
      if (environment.accountId) {
        const current = await this.#store.getAccount(environment.accountId)
        if (
          !current ||
          current.browserProfileId !== environment.browserProfileId ||
          (environment.profileRevision !== undefined &&
            current.browserProfileRevision !== environment.profileRevision) ||
          !sameProfileEnvironment(environment, {
            locale: current.fingerprint.lang,
            timezone: current.fingerprint.timezone,
          })
        )
          throw new Error("SESSION_START_FAILED: 浏览器配置已变化，请重新开始会话")
      }
      if (this.#closed) throw new Error("SESSION_START_FAILED: 会话已结束")
      return release
    } catch (error: unknown) {
      release()
      throw error
    }
  }

  /** 之后的 bind 一律失败，进行中的 bind 也失败；已返回的绑定仍由它的释放操作在 CLI 环境清理后放开。 */
  close(): void {
    this.#closed = true
  }

  /** 选号前过滤环境，实际转发前再核对账号与代理快照，并持有该账号配置直到 CLI 结束。 */
  async choose(
    chooser: Pick<AccountChooser, "choose"> &
      Partial<Pick<AccountChooser, "hasIncompatibleAccount">>,
    input: ChooseAccountInput,
  ): Promise<ChosenAccount | null> {
    const binding = this.#binding
    const chosen = await chooser.choose({
      ...input,
      ...(binding ? { environment: binding.environment } : {}),
    })
    if (
      !chosen &&
      binding &&
      this.#binding === binding &&
      (await chooser.hasIncompatibleAccount?.({ ...input, environment: binding.environment }))
    )
      throw new AccountEnvironmentMismatchError()
    if (!chosen || !binding) return chosen
    if (this.#binding !== binding) return null
    const before = await this.#store.getAccount(chosen.id)
    if (!before?.browserProfileId) return null
    try {
      this.#hold(binding, before.browserProfileId, before.id)
    } catch {
      return null
    }
    const account = await this.#store.getAccount(chosen.id)
    if (
      this.#binding !== binding ||
      !account ||
      account.browserProfileId !== before.browserProfileId ||
      !sameProfileEnvironment(binding.environment, {
        locale: account.fingerprint.lang,
        timezone: account.fingerprint.timezone,
      })
    )
      return null
    const proxy = account.proxyId === null ? null : await this.#store.getProxy(account.proxyId)
    if (
      this.#binding !== binding ||
      (account.proxyId !== null && !proxy) ||
      chosen.proxyUrl !== (proxy?.url ?? null) ||
      chosen.authorization !== account.credential?.accessToken
    )
      return null
    return chosen
  }

  #hold(binding: Binding, profileId: string, accountId?: string): void {
    const key = `${profileId}/${accountId ?? ""}`
    if (!binding.leases.has(key))
      binding.leases.set(key, this.#usage.acquire(profileId, `${binding.token}/${key}`, accountId))
  }
}
