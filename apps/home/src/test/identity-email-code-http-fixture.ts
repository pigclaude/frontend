// 负责中央身份页面的受控 HTTP 边界，保留实际 identityApi 并由测试结算发码及提交响应。
import { interaction, json } from "./identity-fixture"

/** 已送到 HTTP 边界的请求，保证目标与请求体不会随页面草稿变化。 */
export interface PendingIdentityRequest {
  readonly path: string
  readonly body: Record<string, unknown>
  /** 用正式 JSON 响应结算这个请求，不操作应用内部状态。 */
  respond(value: unknown, status?: number): void
  /** 用网络失败结算这个请求，不替换应用错误处理。 */
  reject(reason: Error): void
}

/** 为实际 identityApi 提供公开交互与禁用 CAPTCHA 配置，并延迟身份表单 POST 响应。 */
export function createDeferredIdentityHttp() {
  const requests: PendingIdentityRequest[] = []
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const source = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    const path = new URL(source, "https://home.invalid").pathname
    if (init?.method === "POST") {
      if (!/\/(email-code|password-reset|password)$/.test(path))
        throw new Error(`Unexpected identity POST: ${path}`)
      const body: unknown = JSON.parse(String(init.body))
      if (body === null || typeof body !== "object" || Array.isArray(body))
        throw new Error("Identity POST body must be a JSON object")
      return new Promise<Response>((resolve, reject) => {
        requests.push({
          path,
          body: body as Record<string, unknown>,
          respond(value, status = 200) {
            resolve(json(value, status))
          },
          reject,
        })
      })
    }
    if (path === "/v1/auth/mail-status") return json({ available: true })
    if (path === "/v1/auth/captcha")
      return json({ enabled: false, provider: "turnstile", siteKey: null, mode: "disabled" })
    const match = /^\/v1\/identity\/interactions\/([^/]+)$/.exec(path)
    if (match) return json(interaction({ interactionId: decodeURIComponent(match[1]) }))
    throw new Error(`Unexpected identity GET: ${path}`)
  }
  return { fetch, requests }
}
