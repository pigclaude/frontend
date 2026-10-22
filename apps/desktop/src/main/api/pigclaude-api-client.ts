// 负责以原生 Bearer 访问会员和设备资源，绝不读取或发送网站 Cookie。
import type { MembershipView } from "@pigclaude/contracts/membership"
import type { MembershipInspectRequest } from "@pigclaude/contracts/desktop-membership"
import {
  OAuthClient,
  PigclaudeApiError,
  readSession,
  type OAuthClientOptions,
} from "./oauth-client"

/** 网络选项只允许主进程 Bearer 来源。 */
export type PigclaudeApiClientOptions = OAuthClientOptions
/** 正式桌面授权与业务 API；不保留旧 private flow 端口。 */
export type PigclaudeApi = Pick<
  PigclaudeApiClient,
  | "prepareDeviceAuthorization"
  | "exchangeCode"
  | "refreshToken"
  | "revokeToken"
  | "readDesktopSession"
  | "inspectMembership"
  | "revokeDeviceBinding"
>
/** 共享错误类型使 token 与业务 app_error 保持同一固定边界。 */
export { PigclaudeApiError } from "./oauth-client"

/** 原生业务客户端，使用服务端 token 身份并保持 inspect 与 entitlement 分路。 */
export class PigclaudeApiClient extends OAuthClient {
  /** 联合薄 inspect 和 richer entitlement，不发送自报设备 query。 */
  async inspectMembership(
    input: MembershipInspectRequest,
    token?: string,
  ): Promise<MembershipView> {
    const accessToken = token ?? (await this.bearer())
    const inspected = await this.request("/v1/desktop/membership/inspect", {
      method: "GET",
      accessToken,
    })
    const session = readSession(inspected)
    if (session.deviceId !== input.deviceId || session.bindingEpoch !== input.bindingEpoch) {
      throw new PigclaudeApiError("DEVICE_REVOKED", 401)
    }
    const value = await this.request("/v1/desktop/entitlement", { method: "GET", accessToken })
    if (!isRecord(value)) throw new PigclaudeApiError("INVALID_RESPONSE", 200)
    return {
      startupPhase: "settled",
      revision: 0,
      state:
        value.status === "active"
          ? "active"
          : value.status === "expired"
            ? "expired"
            : "verification_required",
      account: { userId: session.userId, nickname: "", email: "", avatar: "" },
      tier: readTier(value.tier),
      membershipValidUntil: nullableString(value.validUntil),
      offlineValidUntil: null,
      lastVerifiedAt: null,
      nextVerificationAt: null,
      bindingEpoch: session.bindingEpoch,
      errorCode: null,
      serverReason: null,
      authorizationUrl: null,
    }
  }

  /** 只撤销当前 Bearer 绑定的关系，严格发送空 JSON。 */
  async revokeDeviceBinding(token?: string): Promise<void> {
    await this.request("/v1/desktop/devices/revoke", {
      method: "POST",
      body: "{}",
      contentType: "application/json",
      accessToken: token ?? (await this.bearer()),
    })
  }
}
function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readTier(value: unknown): MembershipView["tier"] {
  if (
    !isRecord(value) ||
    typeof value.code !== "string" ||
    typeof value.name !== "string" ||
    typeof value.level !== "number" ||
    !Number.isSafeInteger(value.level) ||
    value.level <= 0
  )
    return null
  return { code: value.code, name: value.name, level: value.level }
}
