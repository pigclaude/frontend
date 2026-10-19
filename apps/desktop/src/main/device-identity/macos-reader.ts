// 负责通过固定只读 ioreg 查询读取 macOS 的 IOPlatformUUID。
import {
  DeviceIdentityUnavailableError,
  runMachineIdCommand,
  withMachineIdDeadline,
  type MachineIdCommandRunner,
  type PlatformMachineIdReader,
} from "./platform-reader"

/** macOS 仅使用 IOPlatformUUID，拒绝缺失或重复结果。 */
export class MacOsMachineIdReader implements PlatformMachineIdReader {
  /** 默认使用受限 execFile，测试可替换系统执行边界。 */
  constructor(private readonly run: MachineIdCommandRunner = runMachineIdCommand) {}

  /** 读取唯一 IOPlatformUUID，不输出或持久化原始 ioreg 内容。 */
  async read(): Promise<{ platform: "darwin"; machineId: string }> {
    return withMachineIdDeadline(async () => {
      const output = await this.run("/usr/sbin/ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"])
      const matches = [...output.matchAll(/"IOPlatformUUID"\s*=\s*"([^"\r\n]*)"/g)]
      if (matches.length !== 1 || !matches[0]?.[1]) throw new DeviceIdentityUnavailableError()
      return { platform: "darwin", machineId: matches[0][1] }
    })
  }
}
