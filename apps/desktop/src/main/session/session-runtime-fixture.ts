// 会话宿主测试用的假本机运行时：记下每个会话打开时的偏好账号、令牌和是否已关闭，
// 并能按会话广播换号事件；不启动 daemon，也不读账号库。

import type {
  SessionProfile,
  SessionRuntime,
  SessionRuntimeEvent,
  SessionRuntimeLease,
  SessionRuntimeLeaseInput,
} from "./session-types"

/** 假运行时里一个会话的记录；令牌按会话 id 生成，便于断言。 */
export type FakeRuntimeSession = {
  sessionId: string
  preferredAccountId: string | null
  token: string
  bound: SessionProfile[]
  closed: boolean
}

/** 可注入换号事件和账号可用性的假 LocalRuntime。 */
export class FakeRuntime implements SessionRuntime {
  daemonBaseUrl: string | null
  availableAccounts = true
  /** 按打开顺序记下的会话。 */
  readonly sessions: FakeRuntimeSession[] = []
  readonly #listeners = new Set<(event: SessionRuntimeEvent) => void>()

  constructor(daemonBaseUrl: string | null = "http://127.0.0.1:47821") {
    this.daemonBaseUrl = daemonBaseUrl
  }

  /** 最近打开的会话的令牌；还没打开过会话时为空字符串。 */
  get sessionToken(): string {
    return this.sessions.at(-1)?.token ?? ""
  }

  /** 订阅 switchAccount 广播的换号事件，返回取消订阅函数。 */
  subscribe(listener: (event: SessionRuntimeEvent) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  /** 记下打开的会话并返回句柄：令牌是 runtime-session-token-<会话 id>，绑定的环境记进 bound，close 记为已关闭。 */
  openSession(input: SessionRuntimeLeaseInput): SessionRuntimeLease {
    const session: FakeRuntimeSession = {
      ...input,
      token: `runtime-session-token-${input.sessionId}`,
      bound: [],
      closed: false,
    }
    this.sessions.push(session)
    return {
      sessionId: session.sessionId,
      token: session.token,
      bindEnvironment: async (profile) => {
        session.bound.push(profile)
        return { release: () => undefined }
      },
      close: () => {
        session.closed = true
      },
    }
  }

  /** 返回 availableAccounts 的当前值。 */
  async hasAvailableAccount(): Promise<boolean> {
    return this.availableAccounts
  }

  /** 模拟 daemon 选号产生的换号事件；省略会话时发给最近打开、还没关闭的会话。 */
  switchAccount(
    from: string | null,
    to: string,
    reason: SessionRuntimeEvent["reason"] = "switch",
    sessionId: string = this.#latestOpen(),
  ): void {
    for (const listener of [...this.#listeners]) {
      listener({ type: "account-switched", sessionId, from, to, reason })
    }
  }

  #latestOpen(): string {
    return this.sessions.findLast((session) => !session.closed)?.sessionId ?? ""
  }
}
