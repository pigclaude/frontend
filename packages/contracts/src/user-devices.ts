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
  /** 桌面端上报的系统与版本；旧关系或未上报时为 null。 */
  osVersion: string | null
  /** 桌面端上报的应用版本；旧关系或未上报时为 null。 */
  appVersion: string | null
  /** 最近一次桌面端活跃写入的公网 IP，受信任代理解析。 */
  lastIp: string | null
  isCurrentDevice: boolean | null
}
/** 管理员设备读取同时给出账号 CAS 版本；本人读取仍是数组。 */
export interface AdminUserDevicesView {
  authVersion: string
  devices: UserDeviceView[]
}
