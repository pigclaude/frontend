// 负责封装第一阶段管理员登录、会员、设备和审计 HTTP endpoint。
import { createSecuritySettingsApi } from "./security-settings"
import type { HttpClient } from "../client"
import type { CaptchaConfig } from "@pigclaude/contracts/captcha"
import type * as T from "./types"

/** 创建管理员 API，统一保留 cookie 和 cursor 分页语义。 */
export function createAdminApi(c: HttpClient) {
  return {
    settings: { turnstile: createSecuritySettingsApi(c) },
    auth: {
      /** 读取管理员登录的公开验证码配置，不依赖管理员会话。 */
      captcha: () => c.get<CaptchaConfig>("/admin/v1/auth/captcha"),
      login: (body: T.AdminLoginRequest) =>
        c.post<T.AdminLoginResponse>("/admin/v1/auth/login", body),
      logout: () => c.post<Record<string, never>>("/admin/v1/auth/logout"),
    },
    me: () => c.get<T.AdminMeResponse>("/admin/v1/me"),
    users: {
      list: (query: T.ListUsersQuery = {}) => c.get<T.ListUsersResponse>("/admin/v1/users", query),
    },
    membership: {
      list: (query: T.ListMembershipsQuery = {}) =>
        c.get<T.ListMembershipsResponse>("/admin/v1/memberships", query),
      grant: (body: T.GrantMembershipRequest) =>
        c.post<T.MembershipItem>("/admin/v1/memberships/grant", body),
      revoke: (body: T.RevokeMembershipRequest) =>
        c.post<T.MembershipItem>(
          `/admin/v1/memberships/${encodeURIComponent(body.userId)}/revoke`,
          { reason: body.reason },
        ),
    },
    devices: {
      list: (query: T.ListMembershipDevicesQuery = {}) =>
        c.get<T.ListMembershipDevicesResponse>("/admin/v1/devices", query),
      unbind: (body: T.UnbindMembershipDeviceRequest) =>
        c.post<Record<string, never>>(
          `/admin/v1/devices/${encodeURIComponent(body.userId)}/unbind`,
          { reason: body.reason },
        ),
    },
    audits: {
      list: (query: T.ListMembershipAuditsQuery = {}) =>
        c.get<T.ListMembershipAuditsResponse>("/admin/v1/audits", query),
    },
  }
}

/** 管理员 API 的结构类型。 */
export type AdminApi = ReturnType<typeof createAdminApi>
