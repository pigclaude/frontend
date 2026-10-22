// 负责封装第一阶段管理员登录、会员、设备和审计 HTTP endpoint。
import { createAdminMembershipApi } from "../membership/admin"
import { createPaymentSettingsApi } from "../membership/payment-settings"
import { createAccountModerationApi } from "./account-moderation"
import type { AdminUserDevicesView } from "@pigclaude/contracts/user-devices"
import { createSecuritySettingsApi } from "./security-settings"
import type { HttpClient } from "../client"
import { createAdminSessionWriter } from "./session"
import type { CaptchaConfig } from "@pigclaude/contracts/captcha"
import type * as T from "./types"

/** 创建管理员 API，统一保留 cookie 和 cursor 分页语义。 */
export function createAdminApi(c: HttpClient) {
  const write = createAdminSessionWriter(c)
  return {
    settings: { turnstile: createSecuritySettingsApi(c), payment: createPaymentSettingsApi(c) },
    auth: {
      /** 读取管理员登录的公开验证码配置，不依赖管理员会话。 */
      captcha: () => c.get<CaptchaConfig>("/admin/v1/auth/captcha"),
      /** 仅退出当前 Admin RP，真实 bootstrap 的 CSRF 保留在 body。 */
      logout: async (isCurrent: () => boolean = () => true) => {
        await write<void>("POST", "/admin/v1/web/oidc/logout", {}, "body", isCurrent)
      },
    },
    me: () => c.get<T.AdminMeResponse>("/admin/v1/me"),
    account: createAccountModerationApi(c),
    users: {
      list: (query: T.ListUsersQuery = {}) => c.get<T.ListUsersResponse>("/admin/v1/users", query),
    },
    membership: createAdminMembershipApi(c),
    devices: {
      /** 只需 device:read，通过已知用户 ID 读取精确设备 envelope。 */
      forUser: (userId: string, afterDeviceId?: string) =>
        c.get<AdminUserDevicesView>(`/admin/v1/users/${encodeURIComponent(userId)}/devices`, {
          limit: 50,
          afterDeviceId,
        }),
      /** 指定关系撤销使用 body CSRF 和两份无损 CAS 版本。 */
      revoke: (
        userId: string,
        deviceId: string,
        body: { expectedBindingEpoch: string; expectedAuthVersion: string; reason: string },
        owner: () => boolean,
      ) =>
        write<void>(
          "POST",
          `/admin/v1/users/${encodeURIComponent(userId)}/devices/${encodeURIComponent(deviceId)}/revoke`,
          body,
          "body",
          owner,
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
