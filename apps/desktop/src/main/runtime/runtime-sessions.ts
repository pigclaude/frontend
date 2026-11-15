// 本机运行时里每个会话自己的选号状态：daemon 令牌、偏好账号、当前账号、额度拒绝和语言时区绑定。
// 账号的冷却和「需要重新授权」属于账号本身，不在这里，由 LocalRuntime 写全局账号库。

import type { DaemonSessions } from "@pigclaude/daemon"
import type { LocalStore } from "@pigclaude/local-store"
import type { BrowserProfileUsage } from "../claude/browser-profile-usage"
import type { SessionRuntimeLease, SessionRuntimeLeaseInput } from "../session/session-types"
import type { AccountChooser, ChosenAccount } from "./account-chooser"
import { SessionAccountEnvironment } from "./session-account-environment"

/** 一次选中带来的账号变化；同一个账号连续选中时没有变化。 */
export type RuntimeAccountChange = {
  from: string | null
  to: string
  reason: "initial" | "switch" | "quota"
}

// 一个会话自己的选号状态；environment 固定它的语言和时区。
type SessionSelection = {
  token: string
  preferredId: string | null
  currentAccountId: string | null
  quotaRejections: Set<string>
  environment: SessionAccountEnvironment
}

/** 按会话 id 保存选号状态的集合。保证不同会话的偏好、当前账号、额度拒绝和环境绑定互不影响；已关闭的会话不再选号。 */
export class RuntimeSessions {
  readonly #tokens: DaemonSessions
  readonly #store: Pick<LocalStore, "getAccount" | "getProxy">
  readonly #usage: BrowserProfileUsage
  readonly #sessions = new Map<string, SessionSelection>()

  /** 绑定 daemon 的令牌注册表、账号读取视图和共享配置使用权。 */
  constructor(
    tokens: DaemonSessions,
    store: Pick<LocalStore, "getAccount" | "getProxy">,
    usage: BrowserProfileUsage,
  ) {
    this.#tokens = tokens
    this.#store = store
    this.#usage = usage
  }

  /** 为会话注册新令牌并建立空的选号状态；同一 id 已打开时抛错，不覆盖在用的会话。 */
  open(input: SessionRuntimeLeaseInput): SessionRuntimeLease {
    if (this.#sessions.has(input.sessionId)) throw new Error("SESSION_ALREADY_ACTIVE: 会话已打开")
    const selection: SessionSelection = {
      token: this.#tokens.register(input.sessionId),
      preferredId: input.preferredAccountId,
      currentAccountId: null,
      quotaRejections: new Set(),
      environment: new SessionAccountEnvironment(this.#store, this.#usage),
    }
    this.#sessions.set(input.sessionId, selection)
    return {
      sessionId: input.sessionId,
      token: selection.token,
      bindEnvironment: (profile, options) => selection.environment.bind(profile, options),
      close: () => this.#close(input.sessionId, selection),
    }
  }

  /** 按会话的偏好和环境选号；会话不存在或已关闭时返回 null。 */
  async choose(
    chooser: Pick<AccountChooser, "choose"> &
      Partial<Pick<AccountChooser, "hasIncompatibleAccount">>,
    sessionId: string,
    rejectedIds: readonly string[],
  ): Promise<ChosenAccount | null> {
    const selection = this.#sessions.get(sessionId)
    if (selection === undefined) return null
    return selection.environment.choose(chooser, {
      rejectedIds,
      ...(selection.preferredId === null ? {} : { preferredId: selection.preferredId }),
    })
  }

  /** 记下会话的一次选中，返回相对上一次实际选中的变化；跨请求换号也以上一次选中的账号为 from。 */
  select(sessionId: string, accountId: string): RuntimeAccountChange | null {
    const selection = this.#sessions.get(sessionId)
    if (selection === undefined) return null
    selection.environment.select(accountId)
    const from = selection.currentAccountId
    const reason =
      from !== null && selection.quotaRejections.has(from)
        ? "quota"
        : from === null
          ? "initial"
          : "switch"
    selection.quotaRejections.delete(accountId)
    if (from !== null) selection.quotaRejections.delete(from)
    selection.currentAccountId = accountId
    return accountId === from ? null : { from, to: accountId, reason }
  }

  /** 读实际已选号的当前出口。无会话、未选号或绑定失效时返回 undefined。 */
  async currentProxyUrl(sessionId: string): Promise<string | null | undefined> {
    const selection = this.#sessions.get(sessionId)
    const accountId = selection?.currentAccountId
    if (accountId == null) return undefined
    const current = () =>
      this.#sessions.get(sessionId) === selection && selection?.currentAccountId === accountId
    const account = await this.#store.getAccount(accountId)
    if (!account?.enabled || !current()) return undefined
    if (account.proxyId === null) return null
    const proxy = await this.#store.getProxy(account.proxyId)
    return current() && proxy?.url ? proxy.url : undefined
  }

  /** 记下会话里一个账号因额度用尽被拒，使下一次换号的原因是 quota。 */
  rejectQuota(sessionId: string, accountId: string): void {
    this.#sessions.get(sessionId)?.quotaRejections.add(accountId)
  }

  /** 关闭全部会话：吊销所有令牌，之后不再为它们选号或绑定环境。 */
  closeAll(): void {
    this.#tokens.revokeAll()
    for (const selection of this.#sessions.values()) selection.environment.close()
    this.#sessions.clear()
  }

  #close(sessionId: string, selection: SessionSelection): void {
    this.#tokens.revoke(selection.token)
    selection.environment.close()
    if (this.#sessions.get(sessionId) === selection) this.#sessions.delete(sessionId)
  }
}
