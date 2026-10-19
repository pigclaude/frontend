// 负责管理员多阶段写入的真实 RP CSRF 与会话代次，不缓存或跨会话复用 token。
import { StaleSessionResponse, type HttpClient } from "../client"
import type { WebSessionBootstrap } from "../web-oidc"
/** 旧业务用 header CSRF；RP 与新严格 DTO 使用显式 body CSRF。 */
export function createAdminSessionWriter(client: HttpClient) {
  return async <T>(
    method: "POST" | "PUT",
    path: string,
    body: object,
    transport: "header" | "body" = "header",
    owner: () => boolean = () => true,
  ): Promise<T> => {
    const isCurrent = client.captureSession?.() ?? (() => true)
    if (!owner() || !isCurrent()) throw new StaleSessionResponse()
    const session = await client.get<WebSessionBootstrap>("/admin/v1/session")
    if (!owner() || !isCurrent()) throw new StaleSessionResponse()
    if (typeof session.csrf !== "string" || !session.csrf)
      throw new Error("会话校验失败，请重新登录")
    const headers = transport === "header" ? { "X-CSRF-Token": session.csrf } : undefined
    const values = transport === "body" ? { ...body, csrf: session.csrf } : body
    return method === "PUT"
      ? client.put<T>(path, values, headers)
      : client.post<T>(path, values, headers)
  }
}
