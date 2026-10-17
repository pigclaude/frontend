// 负责生成和校验浏览器授权所需的 state、PKCE 对和回调参数。
import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import type { AuthorizationCallback, AuthorizationRequest, AuthorizationSession } from "./types"

/** 浏览器授权会话的默认有效时间，保证旧会话不会长期可用。 */
export const AUTHORIZATION_TTL_MS = 10 * 60 * 1000

/** 创建带有随机 state 和 S256 PKCE 的授权会话。 */
export function createAuthorizationSession(input: {
  request: AuthorizationRequest
  redirectUri: string
  now?: number
  ttlMs?: number
}): AuthorizationSession {
  const codeVerifier = toBase64Url(randomBytes(48))
  return {
    sessionId: toBase64Url(randomBytes(16)),
    state: toBase64Url(randomBytes(32)),
    codeVerifier,
    codeChallenge: createPkceChallenge(codeVerifier),
    redirectUri: input.redirectUri,
    expiresAt: (input.now ?? Date.now()) + (input.ttlMs ?? AUTHORIZATION_TTL_MS),
    request: input.request,
    consumed: false,
  }
}

/** 生成不含 padding 的 S256 PKCE challenge。 */
export function createPkceChallenge(verifier: string): string {
  return toBase64Url(createHash("sha256").update(verifier).digest())
}

/** 验证 verifier 是否对应指定的 S256 challenge。 */
export function verifyPkce(verifier: string, challenge: string): boolean {
  const expected = Buffer.from(createPkceChallenge(verifier))
  const actual = Buffer.from(challenge)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

/** 创建授权服务可识别的 URL，不把 verifier 或秘密放进地址。 */
export function buildAuthorizationUrl(session: AuthorizationSession, origin: string): string {
  const url = new URL("/authorize", origin)
  url.searchParams.set("client_id", "pigclaude-desktop")
  url.searchParams.set("session_id", session.sessionId)
  url.searchParams.set("state", session.state)
  url.searchParams.set("code_challenge", session.codeChallenge)
  url.searchParams.set("code_challenge_method", "S256")
  url.searchParams.set("redirect_uri", session.redirectUri)
  url.searchParams.set("purpose", session.request.purpose)
  url.searchParams.set("mode", session.request.mode)
  if (session.request.accountName) url.searchParams.set("account_name", session.request.accountName)
  if (session.request.proxyId) url.searchParams.set("proxy_id", session.request.proxyId)
  return url.toString()
}

/** 校验回调是否仍属于当前、未消费且未过期的授权会话。 */
export function validateAuthorizationCallback(
  session: AuthorizationSession,
  callback: AuthorizationCallback,
  now = Date.now(),
):
  | { ok: true }
  | {
      ok: false
      reason: "denied" | "state-mismatch" | "missing-code" | "expired" | "already-consumed"
    } {
  if (session.consumed) return { ok: false, reason: "already-consumed" }
  if (callback.error) return { ok: false, reason: "denied" }
  if (callback.state !== session.state) return { ok: false, reason: "state-mismatch" }
  if (!callback.code) return { ok: false, reason: "missing-code" }
  if (now >= session.expiresAt) return { ok: false, reason: "expired" }
  return { ok: true }
}

function toBase64Url(value: Buffer): string {
  return value.toString("base64url")
}
