// 负责本人多设备数组、私有名称与精确关系撤销，不在浏览器保存近期证明。
import { StaleSessionResponse, type HttpClient } from "../client"
import type { WebSessionBootstrap } from "../web-oidc"
import type { UserDeviceView } from "@pigclaude/contracts/user-devices"
/** 创建本人设备 facade，每个写入都重新读取真实 RP CSRF 并守卫同一 owner。 */
export function createUserDevicesApi(client: HttpClient) {
  async function write(request: (csrf: string) => Promise<void>, owner: () => boolean) {
    const sameSession = client.captureSession?.() ?? (() => true)
    if (!owner() || !sameSession()) throw new StaleSessionResponse()
    const session = await client.get<WebSessionBootstrap>("/v1/session")
    if (!owner() || !sameSession()) throw new StaleSessionResponse()
    if (typeof session.csrf !== "string" || !session.csrf) throw new Error("会话校验失败")
    await request(session.csrf)
  }
  return {
    /** 按设备 ID 游标读取本人关系，空数组或短页表示末页。 */
    list: (afterDeviceId?: string) =>
      client.get<UserDeviceView[]>("/v1/user/devices", { limit: 50, afterDeviceId }),
    /** 修改当前账号私有名称，epoch 原样发送。 */
    rename: (
      deviceId: string,
      expectedBindingEpoch: string,
      displayName: string,
      owner: () => boolean,
    ) =>
      write(
        (csrf) =>
          client.patch<void>(`/v1/user/devices/${encodeURIComponent(deviceId)}`, {
            csrf,
            expectedBindingEpoch,
            displayName,
          }),
        owner,
      ),
    /** 单关系撤销仍由服务器检查精确近期证明。 */
    revoke: (deviceId: string, expectedBindingEpoch: string, owner: () => boolean) =>
      write(
        (csrf) =>
          client.post<void>(`/v1/user/devices/${encodeURIComponent(deviceId)}/revoke`, {
            csrf,
            expectedBindingEpoch,
          }),
        owner,
      ),
    /** 全部撤销使用独立证明，保留当前网站管理会话。 */
    revokeAll: (owner: () => boolean) =>
      write((csrf) => client.post<void>("/v1/user/devices/revoke-all", { csrf }), owner),
  }
}
