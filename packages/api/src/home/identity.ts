// 负责用户登录方式与精确目标近期核验的 Cookie API，不在浏览器保存证明。
import { StaleSessionResponse, type HttpClient } from "../client"
import type { WebSessionBootstrap } from "../web-oidc"
/** 受支持的外部登录方式。 */
export type IdentityProvider = "google" | "github"
/** 服务端脱敏列表及最后凭据可解绑判断。 */
export interface LinkedIdentity {
  provider: IdentityProvider
  display: string
  canUnlink: boolean
}
/** 近期核验目标严格复用服务端 action 字段，版本始终为原始字符串。 */
export type SensitiveOperation =
  | { operation: "link" | "unlink"; provider: IdentityProvider }
  | { operation: "change_email" }
  | { operation: "revoke_device"; device_id: string; expected_binding_epoch: string }
  | { operation: "revoke_all_devices" }
/** 近期核验只返回状态或受信供应商接续，不暴露 proof。 */
export type ReauthenticationResult = { type: "verified" } | { type: "redirect"; redirect: string }
/** 创建登录方式 facade，每次写入使用当前 RP 会话 bootstrap CSRF。 */
export function createIdentityApi(client: HttpClient) {
  const withCsrf = async <T>(request: (csrf: string) => Promise<T>, isCurrent: () => boolean) => {
    const sameSession = client.captureSession?.() ?? (() => true)
    if (!isCurrent() || !sameSession()) throw new StaleSessionResponse()
    const session = await client.get<WebSessionBootstrap>("/v1/session")
    if (!isCurrent() || !sameSession()) throw new StaleSessionResponse()
    if (typeof session.csrf !== "string" || !session.csrf)
      throw new Error("会话校验失败，请重新登录")
    return request(session.csrf)
  }
  return {
    /** 读取当前会话已绑定的脱敏登录方式。 */
    list: () => client.get<LinkedIdentity[]>("/v1/user/identities"),
    /** 验证当前账号密码，验证码使用 home_login；成功不等于目标操作已经提交。 */
    password: async (
      action: SensitiveOperation,
      password: string,
      captchaToken?: string,
      isCurrent: () => boolean = () => true,
    ) =>
      withCsrf(
        (csrf) =>
          client.post<ReauthenticationResult>("/v1/user/identities/reauth", {
            method: "password",
            csrf,
            action,
            password,
            ...(captchaToken ? { captchaToken } : {}),
          }),
        isCurrent,
      ),
    /** 发起新一轮已绑定供应商核验，目标新身份不能作为当前身份凭据。 */
    provider: async (
      action: SensitiveOperation,
      provider: IdentityProvider,
      isCurrent: () => boolean = () => true,
    ) =>
      withCsrf(
        (csrf) =>
          client.post<ReauthenticationResult>("/v1/user/identities/reauth", {
            method: "provider",
            csrf,
            action,
            provider,
          }),
        isCurrent,
      ),
    /** 绑定仍由服务端重新核验精确目标 proof 与返回身份。 */
    link: async (provider: IdentityProvider, isCurrent: () => boolean = () => true) =>
      withCsrf(
        (csrf) =>
          client.post<{ type: "redirect"; redirect: string }>(
            `/v1/user/identities/${provider}/link`,
            { csrf },
          ),
        isCurrent,
      ),
    /** 删除保留 JSON CSRF 与最后凭据服务端守卫，不做乐观移除。 */
    unlink: async (provider: IdentityProvider, isCurrent: () => boolean = () => true) =>
      withCsrf(
        (csrf) => client.delete<{ type: "unlinked" }>(`/v1/user/identities/${provider}`, { csrf }),
        isCurrent,
      ),
  }
}
