// 负责读取 Linux 唯一允许的 /etc/machine-id，不尝试其他路径。
import { readFile as readSystemFile } from "node:fs/promises"
import { withMachineIdDeadline, type PlatformMachineIdReader } from "./platform-reader"

/** 可取消的 UTF-8 文件读取端口，原始文件内容只留在主进程。 */
export type MachineIdFileReader = (
  path: string,
  options: { encoding: "utf8"; signal: AbortSignal },
) => Promise<string>

/** Linux 固定使用 /etc/machine-id，缺失或权限不足时封闭失败。 */
export class LinuxMachineIdReader implements PlatformMachineIdReader {
  /** 默认使用 Node 文件读取，测试可替换系统文件边界。 */
  constructor(private readonly readFile: MachineIdFileReader = readSystemFile) {}

  /** 读取唯一系统路径并在二十秒后中止，不使用 dbus 或随机替代。 */
  async read(): Promise<{ platform: "linux"; machineId: string }> {
    return withMachineIdDeadline(async (signal) => ({
      platform: "linux",
      machineId: await this.readFile("/etc/machine-id", { encoding: "utf8", signal }),
    }))
  }
}
