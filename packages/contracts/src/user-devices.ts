// 负责本人设备关系和管理员设备 envelope 的正式契约。
/** 设备摘要只展示该账号的私有关系，不包含同硬件其他账号。 */
export interface UserDeviceView {
  deviceId: string
  platform: "macos" | "windows" | "linux"
  displayName: string
  status: "active" | "revoked"
  bindingEpoch: string
  firstAuthorizedAt: string
  lastSeenAt: string | null
  isCurrentDevice: boolean | null
}
/** 管理员设备读取同时给出账号 CAS 版本；本人读取仍是数组。 */
export interface AdminUserDevicesView {
  authVersion: string
  devices: UserDeviceView[]
}
