// 负责定义浏览器设备授权 flow 的脱敏跨进程契约和错误码。

/** 设备授权流程的有限状态集合。 */
export type DeviceAuthorizationStatus = "pending" | "approved" | "expired" | "rejected" | "consumed"

/** 授权流程可安全传给 renderer 的视图，不包含私钥或 session token。 */
export interface DeviceAuthorizationView {
  flowId: string
  deviceId: string
  deviceFingerprintHash: string
  status: DeviceAuthorizationStatus
  existingDeviceId: string | null
  existingBindingEpoch: string | null
  requiresReplace: boolean
  expiresAt: string | null
}

/** 服务端授权错误的稳定枚举名，供 UI 展示和重试策略使用。 */
export type AuthorizationErrorCode =
  | "AUTHORIZATION_NOT_FOUND"
  | "AUTHORIZATION_EXPIRED"
  | "AUTHORIZATION_INVALID_STATE"
  | "AUTHORIZATION_ALREADY_APPROVED"
  | "AUTHORIZATION_REPLACE_REQUIRED"
  | "AUTHORIZATION_BINDING_STALE"
  | "AUTHORIZATION_DEVICE_REVOKED"
  | "AUTHORIZATION_UNAUTHORIZED"
  | "AUTHORIZATION_INTERNAL"
