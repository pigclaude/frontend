// 负责公开目录、本人报价和携带 body CSRF 的订单命令，不参与定价。
import { StaleSessionResponse, type HttpClient } from "../client"
import type { WebSessionBootstrap } from "../web-oidc"
import type * as T from "./types"
/** 创建 Home 会员 API，写入绑定原始会话及界面 owner。 */
export function createHomeMembershipApi(client: HttpClient) {
  const path = "/v1/membership"
  return {
    /** 读取无需登录的目录。 */
    catalog: () => client.get<T.Catalog>(`${path}/catalog`),
    /** 读取本人报价。 */
    quotes: () => client.get<T.Quotes>(`${path}/quotes`),
    /** 读取独立权益，不依赖用户摘要字段。 */
    entitlement: () => client.get<T.EntitlementResponse>("/v1/entitlement"),
    /** 仅核对当前网站会话是否与短期目标一致，不据此登录或指定付款人。 */
    recoveryTarget: (target: string) =>
      client.get<T.MembershipRecoveryResolution>(
        `${path}/recovery-targets/${encodeURIComponent(target)}`,
      ),
    /** 只传购买意图和即时 CSRF，价格由服务端重报价。 */
    createOrder: async (input: T.CreateOrderInput, owner: () => boolean) => {
      const sameSession = client.captureSession?.() ?? (() => true)
      const check = () => {
        if (!owner() || !sameSession()) throw new StaleSessionResponse()
      }
      check()
      const session = await client.get<WebSessionBootstrap>("/v1/session")
      check()
      if (typeof session.csrf !== "string" || !session.csrf) throw new Error("会话校验失败")
      const result = await client.post<T.CreatedOrder>(`${path}/orders`, {
        ...input,
        csrf: session.csrf,
      })
      check()
      return result
    },
    /** 分页读取当前用户的订单历史。 */
    orders: (query: { cursor?: string; limit?: number } = {}) =>
      client.get<T.HomeOrderPage>(`${path}/orders`, query),
    /** 只查询当前登录用户拥有的订单。 */
    order: (orderNo: string) =>
      client.get<T.HomeOrder>(`${path}/orders/${encodeURIComponent(orderNo)}`),
  }
}
/** Home 会员 facade 的结构类型。 */
export type HomeMembershipApi = ReturnType<typeof createHomeMembershipApi>
