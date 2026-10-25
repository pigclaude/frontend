// 负责已登录账号的发码、改邮箱与设置/修改密码写入，每次写入先读取当前会话 CSRF。

import { StaleSessionResponse, type HttpClient } from "../client"
import type { WebSessionBootstrap } from "../web-oidc"

/** 账号凭据允许的两种验证码用途。 */
export type AccountCodePurpose = "change_email" | "password"

/** 发码接口的固定 202 响应，不区分邮箱占用分支。 */
export interface EmailCodeSent {
  type: "sent"
  resendAfterSeconds: number
}

/** 改邮箱成功响应只返回新的登录邮箱。 */
export interface EmailChanged {
  email: string
}

/** 创建账号凭据 facade，所有写入绑定当前 RP 会话与界面 owner。 */
export function createAccountCredentialApi(client: HttpClient) {
  const withCsrf = async <T>(
    request: (csrf: string) => Promise<T>,
    isCurrent: () => boolean,
  ): Promise<T> => {
    const sameSession = client.captureSession?.() ?? (() => true)
    const check = () => {
      if (!isCurrent() || !sameSession()) throw new StaleSessionResponse()
    }
    check()
    const session = await client.get<WebSessionBootstrap>("/v1/session")
    check()
    if (typeof session.csrf !== "string" || !session.csrf)
      throw new Error("会话校验失败，请重新登录")
    return request(session.csrf)
  }

  return {
    /** 请求改邮箱或密码验证码；邮箱占用时服务端仍返回同一 202。 */
    sendCode: (
      input: { purpose: AccountCodePurpose; email?: string; captchaToken?: string },
      isCurrent: () => boolean = () => true,
    ) =>
      withCsrf(
        (csrf) => client.post<EmailCodeSent>("/v1/user/email-code", { ...input, csrf }),
        isCurrent,
      ),
    /** 提交新邮箱与绑定该邮箱的验证码，服务端同事务消费近期证明。 */
    changeEmail: (
      input: { email: string; emailCode: string },
      isCurrent: () => boolean = () => true,
    ) =>
      withCsrf(
        (csrf) => client.post<EmailChanged>("/v1/user/email", { ...input, csrf }),
        isCurrent,
      ),
    /** 提交密码验证码与新密码；成功后当前会话和全部其他会话失效。 */
    changePassword: (
      input: { emailCode: string; newPassword: string },
      isCurrent: () => boolean = () => true,
    ) =>
      withCsrf(
        (csrf) =>
          client.post<{ type: "password_changed" }>("/v1/user/password", {
            ...input,
            csrf,
          }),
        isCurrent,
      ),
  }
}
