// 负责管理员会员目录、授予、撤销和订单查询，所有写入统一 header CSRF。
import type { HttpClient } from "../client"
import { createAdminSessionWriter } from "../admin/session"
import type * as T from "./types"
/** 创建会员管理 API，不改变既有用户与设备 API。 */
export function createAdminMembershipApi(client: HttpClient) {
  const write = createAdminSessionWriter(client)
  const path = "/admin/v1/membership"
  return {
    tiers: {
      /** 读取完整等级目录，需要 membership:read。 */
      list: () => client.get<{ items: T.Tier[] }>(`${path}/tiers`),
      /** 预览始终提交不可变 code，返回的临时 ID 不写回输入。 */
      preview: (input: T.TierInput & { code: string }, owner: () => boolean = () => true) =>
        write<T.Tier>("POST", `${path}/tiers/preview`, tierFields(input, true), "header", owner),
      /** 保存保留编辑 ID，已有等级省略 code；预览结果不改变原始输入。 */
      save: (id: string, input: T.TierInput, owner: () => boolean = () => true) => {
        return write<T.Tier>(
          "PUT",
          `${path}/tiers/${encodeURIComponent(id)}`,
          tierFields(input, id === "new"),
          "header",
          owner,
        )
      },
      /** 只切换上下架，其他字段保持服务端现值，不会覆盖其他管理员的编辑。 */
      setEnabled: (id: string, enabled: boolean, owner: () => boolean = () => true) =>
        write<void>(
          "PUT",
          `${path}/tiers/${encodeURIComponent(id)}/enabled`,
          { enabled },
          "header",
          owner,
        ),
      /** 通过正式 DELETE 软删除等级。 */
      remove: (id: string, owner: () => boolean = () => true) =>
        write<void>("DELETE", `${path}/tiers/${encodeURIComponent(id)}`, {}, "header", owner),
    },
    memberships: {
      /** 查询真实生效状态和精确服务端分页。 */
      list: (query: T.ListMembershipsQuery = {}) =>
        client.get<T.ListMembershipsResponse>("/admin/v1/memberships", query),
    },
    users: {
      /** 用户选择器与既有用户管理列表分离。 */
      search: (q: string) => client.get<{ items: T.UserPick[] }>(`${path}/users`, { q }),
    },
    grants: {
      /** 预览属于写权限操作，同样携带 CSRF。 */
      preview: (input: T.GrantInput, owner: () => boolean = () => true) =>
        write<T.GrantPreview>("POST", `${path}/grants/preview`, input, "header", owner),
      /** 提交显式授予，返回最新权益。 */
      create: (input: T.GrantInput, owner: () => boolean = () => true) =>
        write<T.EntitlementResponse>("POST", `${path}/grants`, input, "header", owner),
    },
    /** 撤销按用户 ID 路由且只提交原因。 */
    revoke: (input: T.RevokeInput, owner: () => boolean = () => true) =>
      write<T.EntitlementResponse>(
        "POST",
        `/admin/v1/memberships/${encodeURIComponent(input.userId)}/revoke`,
        { reason: input.reason },
        "header",
        owner,
      ),
    orders: {
      /** 读取服务端统一口径订单统计。 */
      summary: () => client.get<T.AdminOrdersSummary>("/admin/v1/payment/orders/summary"),
      /** 支付只读用户直接使用响应 filterTiers，无需请求会员目录。 */
      list: (query: T.AdminOrdersQuery = {}) =>
        client.get<T.AdminOrders>("/admin/v1/payment/orders", query),
    },
  }
}
/** 管理员会员 facade 的结构类型。 */
export type AdminMembershipApi = ReturnType<typeof createAdminMembershipApi>

// 只序列化输入字段，避免直接使用查询对象时把临时 ID 或计算金额提交给严格 DTO。
function tierFields(input: T.TierInput, includeCode: boolean): T.TierInput {
  return {
    ...(includeCode ? { code: input.code } : {}),
    name: input.name,
    level: input.level,
    monthlyPriceFen: input.monthlyPriceFen,
    tagline: input.tagline,
    cardStyle: input.cardStyle,
    benefits: input.benefits,
    enabled: input.enabled,
    options: input.options.map(
      ({ id, months, discountKind, discountValue, badge, recommended, enabled }) => ({
        ...(id === undefined ? {} : { id }),
        months,
        discountKind,
        discountValue,
        badge,
        recommended,
        enabled,
      }),
    ),
  }
}
