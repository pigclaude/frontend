// 负责通过固定 CIM 查询读取 Windows SMBIOS 系统 UUID。
import {
  runMachineIdCommand,
  withMachineIdDeadline,
  type MachineIdCommandRunner,
  type PlatformMachineIdReader,
} from "./platform-reader"

// 慢速 Windows 上 PowerShell 冷启动和 CIM 查询可能超过默认读取期限。
const WINDOWS_CIM_DEADLINE_MS = 45_000

/** Windows 仅使用 Win32_ComputerSystemProduct.UUID，不读取 MachineGuid。 */
export class WindowsMachineIdReader implements PlatformMachineIdReader {
  /** 设备身份派生和 CIM 子进程使用同一有限读取时间。 */
  readonly deadlineMs = WINDOWS_CIM_DEADLINE_MS

  /** 默认使用无 shell 的固定 PowerShell 命令，测试可替换执行边界。 */
  constructor(
    private readonly run: MachineIdCommandRunner = (file, args) =>
      runMachineIdCommand(file, args, WINDOWS_CIM_DEADLINE_MS),
  ) {}

  /** 读取 SMBIOS UUID，查询异常统一转换为固定不可用错误。 */
  async read(): Promise<{ platform: "win32"; machineId: string }> {
    return withMachineIdDeadline(
      async () => ({
        platform: "win32",
        machineId: (
          await this.run("powershell.exe", [
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "(Get-CimInstance -ClassName Win32_ComputerSystemProduct -ErrorAction Stop).UUID",
          ])
        ).trim(),
      }),
      this.deadlineMs,
    )
  }
}
