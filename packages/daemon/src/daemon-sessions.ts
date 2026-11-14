// daemon 的令牌到会话映射。每个会话注册时拿到一个新的随机令牌，吊销后这个令牌立即不能再用；
// 映射独立于 LocalDaemon 实例，daemon 意外退出重启后在用的会话仍然有效。

import { randomBytes } from "node:crypto"

/** daemon 按请求头里的令牌查会话的端口。保证未知或已吊销的令牌返回 null。 */
export type DaemonSessionLookup = {
  resolve(token: string): string | null
}

/** 令牌到会话 id 的注册表。保证令牌是 32 字节随机数的 base64url；吊销或清空后不再解析。 */
export class DaemonSessions implements DaemonSessionLookup {
  readonly #sessions = new Map<string, string>()

  /** 为会话生成并登记一个新令牌；同一个会话可以多次注册，每次得到不同的令牌。 */
  register(sessionId: string): string {
    const token = randomBytes(32).toString("base64url")
    this.#sessions.set(token, sessionId)
    return token
  }

  /** 吊销一个令牌；不认识的令牌忽略。 */
  revoke(token: string): void {
    this.#sessions.delete(token)
  }

  /** 吊销全部令牌。 */
  revokeAll(): void {
    this.#sessions.clear()
  }

  /** 返回令牌所属的会话 id；未知或已吊销时返回 null。 */
  resolve(token: string): string | null {
    return this.#sessions.get(token) ?? null
  }
}
