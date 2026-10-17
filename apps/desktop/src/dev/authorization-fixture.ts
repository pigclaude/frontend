// 负责在本地开发环境模拟浏览器授权服务的 code、PKCE 和 token exchange。
import { randomUUID } from "node:crypto"
import { verifyPkce } from "../main/authorization/pkce"
import type { AuthorizationSession, AuthorizationToken } from "../main/authorization/types"

/** 本地授权夹具的依赖，保证测试可以控制时间。 */
export type DevAuthorizationFixtureOptions = {
  now?: () => number
}

/** 授权确认后返回给浏览器的跳转结果。 */
export type DevAuthorizationApproval = {
  redirectUrl: string
}

type AuthorizationCode = {
  code: string
  session: AuthorizationSession
  consumed: boolean
}

/** 本地浏览器授权服务，保证 code 单次交换且验证 PKCE。 */
export class DevAuthorizationFixture {
  readonly #now: () => number
  readonly #sessions = new Map<string, AuthorizationSession>()
  readonly #codes = new Map<string, AuthorizationCode>()

  /** 创建开发夹具。 */
  constructor(options: DevAuthorizationFixtureOptions = {}) {
    this.#now = options.now ?? Date.now
  }

  /** 记录主进程创建的会话，供浏览器确认页使用。 */
  recordSession(session: AuthorizationSession): void {
    this.#sessions.set(session.sessionId, session)
  }

  /** 模拟用户点击确认授权并生成一次性 code。 */
  approve(input: { sessionId: string; state: string }): DevAuthorizationApproval {
    const session = this.#sessions.get(input.sessionId)
    if (!session || session.state !== input.state) throw new Error("授权会话无效")
    if (this.#now() >= session.expiresAt) throw new Error("授权会话已过期")
    const code = randomUUID()
    this.#codes.set(code, { code, session, consumed: false })
    const redirect = new URL(session.redirectUri)
    redirect.searchParams.set("code", code)
    redirect.searchParams.set("state", session.state)
    return { redirectUrl: redirect.toString() }
  }

  /** 用 code 和 verifier 换取测试 token，保证 code 只能成功一次。 */
  exchange(input: {
    code: string
    clientId: string
    codeVerifier: string
    redirectUri: string
  }): AuthorizationToken {
    const record = this.#codes.get(input.code)
    if (!record || record.consumed) throw new Error("授权码已消费")
    if (this.#now() >= record.session.expiresAt) throw new Error("授权码已过期")
    if (input.clientId !== "pigclaude-desktop") throw new Error("client 不匹配")
    if (input.redirectUri !== record.session.redirectUri) throw new Error("回调地址不匹配")
    if (!verifyPkce(input.codeVerifier, record.session.codeChallenge)) {
      throw new Error("PKCE 校验失败")
    }
    record.consumed = true
    const isClaudeAccount = record.session.request.purpose === "claude-account"
    return {
      accessToken: `fixture-access-${record.session.sessionId}`,
      refreshToken: `fixture-refresh-${record.session.sessionId}`,
      credential: isClaudeAccount ? `fixture-credential-${record.session.sessionId}` : undefined,
      accountId: isClaudeAccount
        ? `claude-${record.session.sessionId.slice(0, 8)}`
        : "pigclaude-user",
      displayName: record.session.request.accountName ?? "林舟",
      expiresAt: this.#now() + 3_600_000,
      purpose: record.session.request.purpose,
      mode: record.session.request.mode,
    }
  }
}
