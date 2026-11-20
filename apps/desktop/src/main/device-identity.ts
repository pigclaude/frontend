// 负责在主进程从固定系统标识派生跨账号、profile 和安装稳定的设备身份。
import { createHmac } from "node:crypto"
import {
  createPlatformMachineIdReader,
  DeviceIdentityUnavailableError,
  withMachineIdDeadline,
  type DevicePlatform,
  type PlatformMachineIdReader,
} from "./device-identity/platform-reader"

/** 只允许派生设备 ID 和平台离开机器标识读取边界。 */
export type DeviceIdentity = { deviceId: string; platform: DevicePlatform }

/** 设备身份独立于账号、安全仓库和安装目录，不读取旧随机身份。 */
export class DeviceIdentityService {
  #pending: Promise<DeviceIdentity> | undefined

  /** 默认选择当前系统的唯一固定来源，测试可注入只读平台端口。 */
  constructor(private readonly reader: PlatformMachineIdReader = createPlatformMachineIdReader()) {}

  /** 合并并发读取，只缓存派生结果；失败不返回替代身份或原始错误。 */
  read(): Promise<DeviceIdentity> {
    this.#pending ??= withMachineIdDeadline(async () => {
      const { platform, machineId } = await this.reader.read()
      const normalized = normalizeMachineId(platform, machineId)
      const digest = createHmac("sha256", "pigclaude/device-id/v1")
        .update(platform, "utf8")
        .update(Buffer.from([0]))
        .update(normalized, "utf8")
        .digest("hex")
      return { deviceId: `pcd_${digest}`, platform }
    }, this.reader.deadlineMs).catch(() => {
      this.#pending = undefined
      throw new DeviceIdentityUnavailableError()
    })
    return this.#pending
  }
}

function normalizeMachineId(platform: DevicePlatform, machineId: string): string {
  if (!["darwin", "win32", "linux"].includes(platform) || typeof machineId !== "string") {
    throw new DeviceIdentityUnavailableError()
  }
  const trimmed = machineId.trim()
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const normalized =
    platform !== "linux" && uuid.test(trimmed)
      ? trimmed.replaceAll("-", "").toLowerCase()
      : trimmed.toLowerCase()
  if (!/^[0-9a-f]{32}$/.test(normalized) || /^(?:0{32}|f{32})$/.test(normalized)) {
    throw new DeviceIdentityUnavailableError()
  }
  return normalized
}
