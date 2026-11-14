// 负责定义机器标识读取边界，限制只读子进程并统一超时和错误脱敏。
import { execFile } from "node:child_process"
import { MacOsMachineIdReader } from "./macos-reader"
import { WindowsMachineIdReader } from "./windows-reader"
import { LinuxMachineIdReader } from "./linux-reader"

/** 允许派生设备身份的三个固定系统平台。 */
export type DevicePlatform = "darwin" | "win32" | "linux"

/** 原机器标识只在主进程读取与派生边界内短暂存在。 */
export interface PlatformMachineIdReader {
  /** 从平台唯一来源读取机器标识，不查询备用来源。 */
  read(): Promise<{ platform: DevicePlatform; machineId: string }>
}

/** 固定只读命令的可替换执行边界，不接受 shell 脚本拼接。 */
export type MachineIdCommandRunner = (file: string, args: string[]) => Promise<string>

/** 机器标识不可用时只暴露固定代码，绝不保留系统错误及其输出。 */
export class DeviceIdentityUnavailableError extends Error {
  readonly code = "DEVICE_ID_UNAVAILABLE"

  /** 创建不携带原始值、系统路径或底层异常的稳定错误。 */
  constructor() {
    super("DEVICE_ID_UNAVAILABLE")
    this.name = "DeviceIdentityUnavailableError"
  }
}

// Windows 上第一次启动 PowerShell 查询 CIM 就要四五秒，期限要远大于这个时间。
const MACHINE_ID_DEADLINE_MS = 20_000

/** 在最多二十秒内完成读取，超时中止可取消的 IO，并擦除底层错误细节。 */
export async function withMachineIdDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new DeviceIdentityUnavailableError())
    }, MACHINE_ID_DEADLINE_MS)
  })
  try {
    return await Promise.race([operation(controller.signal), timeout])
  } catch {
    throw new DeviceIdentityUnavailableError()
  } finally {
    clearTimeout(timer)
  }
}

/** 使用无 shell 的固定参数子进程读取，限制运行时间和内存输出。 */
export function runMachineIdCommand(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      execFile(
        file,
        args,
        {
          encoding: "utf8",
          timeout: MACHINE_ID_DEADLINE_MS,
          maxBuffer: 64 * 1024,
          windowsHide: true,
          shell: false,
        },
        (error, stdout) => {
          if (error) reject(new DeviceIdentityUnavailableError())
          else resolve(stdout)
        },
      )
    } catch {
      reject(new DeviceIdentityUnavailableError())
    }
  })
}

/** 为当前平台选择唯一固定来源，未知平台明确失败而不生成替代身份。 */
export function createPlatformMachineIdReader(
  platform: string = process.platform,
): PlatformMachineIdReader {
  switch (platform) {
    case "darwin":
      return new MacOsMachineIdReader()
    case "win32":
      return new WindowsMachineIdReader()
    case "linux":
      return new LinuxMachineIdReader()
    default:
      return {
        read: async () => {
          throw new DeviceIdentityUnavailableError()
        },
      }
  }
}
