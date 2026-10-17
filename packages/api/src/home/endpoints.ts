// 负责封装第一阶段 home 登录、会员和设备授权 HTTP endpoint。
import type { HttpClient } from "../client"
import type * as T from "./types"

/** 创建 home API，所有请求复用共享 cookie client。 */
export function createHomeApi(c: HttpClient) {
  return {
    auth: {
      register: (body: T.RegisterRequest) =>
        c.post<Record<string, never>>("/v1/auth/register", body),
      login: (body: T.LoginRequest) => c.post<Record<string, never>>("/v1/auth/login", body),
      logout: () => c.post<Record<string, never>>("/v1/auth/logout"),
      forgotPassword: (body: T.ForgotPasswordRequest) =>
        c.post<Record<string, never>>("/v1/auth/password/forgot", body),
      resetPassword: (body: T.ResetPasswordRequest) =>
        c.post<Record<string, never>>("/v1/auth/password/reset", body),
      githubLoginUrl: (redirect: string) =>
        `/v1/auth/github/login?redirect=${encodeURIComponent(redirect)}`,
    },
    user: { me: () => c.get<T.MeResponse>("/v1/user/me") },
    membership: {
      plans: () => c.get<T.ListPlansResponse>("/v1/plans"),
      entitlement: () => c.get<T.EntitlementResponse>("/v1/entitlement"),
    },
    authorizations: {
      get: (flowId: string) =>
        c.get<T.AuthorizationResponse>(`/v1/authorizations/${encodeURIComponent(flowId)}`),
      approve: (flowId: string, body: T.ApproveAuthorizationRequest) =>
        c.post<T.ApproveAuthorizationResponse>(
          `/v1/authorizations/${encodeURIComponent(flowId)}/approve`,
          body,
        ),
    },
  }
}

/** home API 的结构类型。 */
export type HomeApi = ReturnType<typeof createHomeApi>
