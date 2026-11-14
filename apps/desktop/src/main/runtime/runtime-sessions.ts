// 本机运行时里每个会话自己的选号状态：daemon 令牌、偏好账号、当前账号、额度拒绝和语言时区绑定。
// 账号的冷却和「需要重新授权」属于账号本身，不在这里，由 LocalRuntime 写全局账号库。

import type { DaemonSessions } from "@pigclaude/daemon"
import type { LocalStore } from "@pigclaude/local-store"
import type { BrowserProfileUsage } from "../claude/browser-profile-usage"
import type { ProfileEnvironment } from "../session/profile-environment"
import type { AccountChooser, ChosenAccount } from "./account-chooser"
import { SessionAccountEnvironment } from "./session-account-environment"

/** 会话宿主拿到的一个会话的路由句柄。保证 token 只认这一个会话；close 吊销令牌、停止为它选号，可重复调用。 */
export type RuntimeSession = {
  readonly sessionId: string
  readonly token: string
  /** CLI 启动前固定这个会话的语言和时区，之后它只换入同环境的账号；返回的释放操作在 CLI 环境清理后调用。 */
  bindEnvironment(profile: ProfileEnvironment): Promise<() => void>
  close(): void
}

/** 打开会话的参数；preferredAccountId 只是偏好，不可用时按切换规则选其他账号。 */
export type OpenRuntimeSession = {
  sessionId: string
  preferredAccountId: string | null
}

/** 一次选中带来的账号变化；同一个账号连续选中时没有变化。 */
export type RuntimeAccountChange = {
  from: string | null
  to: string
  reason: "initial" | "switch" | "quota"
}

type Tracked = {
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
  readonly #sessions = new Map<string, Tracked>()

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
  open(input: OpenRuntimeSession): RuntimeSession {
    if (this.#sessions.has(input.sessionId)) throw new Error("SESSION_ALREADY_ACTIVE: 会话已打开")
    const tracked: Tracked = {
      token: this.#tokens.register(input.sessionId),
      preferredId: input.preferredAccountId,
      currentAccountId: null,
      quotaRejections: new Set(),
      environment: new SessionAccountEnvironment(this.#store, this.#usage),
    }
    this.#sessions.set(input.sessionId, tracked)
    return {
      sessionId: input.sessionId,
      token: tracked.token,
      bindEnvironment: (profile) => tracked.environment.bind(profile),
      close: () => this.#close(input.sessionId, tracked),
    }
  }

  /** 按会话的偏好和环境选号；会话不存在或已关闭时返回 null。 */
  async choose(
    chooser: Pick<AccountChooser, "choose"> &
      Partial<Pick<AccountChooser, "hasIncompatibleAccount">>,
    sessionId: string,
    rejectedIds: readonly string[],
  ): Promise<ChosenAccount | null> {
    const tracked = this.#sessions.get(sessionId)
    if (tracked === undefined) return null
    return tracked.environment.choose(chooser, {
      rejectedIds,
      ...(tracked.preferredId === null ? {} : { preferredId: tracked.preferredId }),
    })
  }

  /** 记下会话的一次选中，返回相对上一次实际选中的变化；跨请求换号也以上一次选中的账号为 from。 */
  select(sessionId: string, accountId: string): RuntimeAccountChange | null {
    const tracked = this.#sessions.get(sessionId)
    if (tracked === undefined) return null
    const from = tracked.currentAccountId
    const reason =
      from !== null && tracked.quotaRejections.has(from)
        ? "quota"
        : from === null
          ? "initial"
          : "switch"
    tracked.quotaRejections.delete(accountId)
    if (from !== null) tracked.quotaRejections.delete(from)
    tracked.currentAccountId = accountId
    return accountId === from ? null : { from, to: accountId, reason }
  }

  /** 记下会话里一个账号因额度用尽被拒，使下一次换号的原因是 quota。 */
  rejectQuota(sessionId: string, accountId: string): void {
    this.#sessions.get(sessionId)?.quotaRejections.add(accountId)
  }

  /** 关闭全部会话：吊销所有令牌，之后不再为它们选号或绑定环境。 */
  closeAll(): void {
    this.#tokens.revokeAll()
    for (const tracked of this.#sessions.values()) tracked.environment.close()
    this.#sessions.clear()
  }

  #close(sessionId: string, tracked: Tracked): void {
    this.#tokens.revoke(tracked.token)
    tracked.environment.close()
    if (this.#sessions.get(sessionId) === tracked) this.#sessions.delete(sessionId)
  }
}
