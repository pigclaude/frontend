// 根据单个 PID 读取系统进程身份，只有可执行文件与启动代次都匹配时才允许终止。

import { execFile } from "node:child_process"
import { readFile, readlink, realpath } from "node:fs/promises"
import { isAbsolute, normalize, win32 } from "node:path"
import { setTimeout } from "node:timers/promises"
import { promisify } from "node:util"
import { fileErrorCode, isPlainRecord } from "./session-store-guards"

/** 一次子进程的身份；startedAt 是平台生成的标识，包含进程出生时间。 */
export type RetainedClaudeProcess = { pid: number; executable: string; startedAt: string }

const run = promisify(execFile)
const waitMs = 3_000
const probeTimeoutMs = 10_000
/** Windows PowerShell 冷启动可能超过 45 秒，超时仍按身份未确认处理。 */
export const windowsClaudeProcessTimeoutMs = 75_000
const pidLimit = 2_147_483_647
const systemEnv = { PATH: "/usr/bin:/bin:/usr/sbin", LC_ALL: "C", LANG: "C", TZ: "UTC" }

/** 可以安全报告的进程身份及记录操作阶段。 */
export type ClaudeProcessPhase =
  | "读取进程身份"
  | "核对进程身份"
  | "核对可执行文件"
  | "核对并停止进程"
  | "停止进程"
  | "读取进程记录"
  | "保存进程记录"
  | "移除进程记录"

/** 内部错误只标记操作阶段，系统命令、输出及进程路径都不进入错误文本。 */
export class ClaudeProcessPhaseError extends Error {
  /** 标记失败是在读取、核对还是关闭进程时。 */
  constructor(phase: ClaudeProcessPhase, timedOut = false) {
    super(`无法安全核对或回收会话的 Claude Code 进程（${phase}${timedOut ? "超时" : "失败"}）`)
    this.name = "ClaudeProcessPhaseError"
  }
}

/** 只接受系统进程 ID 的范围，排除 PID 0、进程组和桌面主进程。 */
export function isClaudeProcessPid(pid: unknown): pid is number {
  return (
    typeof pid === "number" &&
    Number.isSafeInteger(pid) &&
    pid > 1 &&
    pid <= pidLimit &&
    pid !== process.pid
  )
}

/** 只接受当前平台完整的启动代次，可区分损坏记录和已经复用的 PID。 */
export function isClaudeProcessBirth(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 160) return false
  if (process.platform === "win32") return /^win32:\d+$/.test(value)
  const [, platform, boot, created] = /^([^:]+):([^:]+):(.+)$/.exec(value) ?? []
  if (platform !== process.platform || boot === undefined || !validBootId(boot)) return false
  if (platform === "linux") return /^\d+$/.test(created ?? "")
  return platform === "darwin" && macStart.test(created ?? "")
}

/** 比较同一平台的完整执行路径；Windows 使用规范化后的路径并折叠大小写。 */
export function sameExecutable(left: string, right: string): boolean {
  return process.platform === "win32"
    ? normalize(left).toLowerCase() === normalize(right).toLowerCase()
    : left === right
}

/** 读出指定进程的完整执行路径和启动代次；已退出为 null，不能确认则抛错。 */
export async function readClaudeProcess(pid: number): Promise<RetainedClaudeProcess | null> {
  if (!isClaudeProcessPid(pid)) throw new Error("Claude Code 进程号无效")
  switch (process.platform) {
    case "darwin":
      return readMacProcess(pid)
    case "linux":
      return readLinuxProcess(pid)
    case "win32":
      return readWindowsProcess(pid)
    default:
      throw new Error("当前平台无法核对 Claude Code 进程")
  }
}

/** 证实仍是这一代进程后结束并等待退出；已退出或已换代不发信号。 */
export async function stopClaudeProcess(identity: RetainedClaudeProcess): Promise<void> {
  if (!isClaudeProcessPid(identity.pid)) throw new ClaudeProcessPhaseError("核对进程身份")
  if (process.platform === "win32") {
    const result = await runWindowsProcess(identity.pid, identity)
    if (result === "verify-failed") throw new ClaudeProcessPhaseError("核对进程身份")
    if (result === "stop-timeout") throw new ClaudeProcessPhaseError("停止进程", true)
    if (result === "stop-failed") throw new ClaudeProcessPhaseError("停止进程")
    if (result !== "released") throw new ClaudeProcessPhaseError("核对并停止进程")
    return
  }
  if (!(await signalOwnedProcess(identity, "SIGTERM"))) return
  if (await waitUntilGone(identity)) return
  if (!(await signalOwnedProcess(identity, "SIGKILL"))) return
  if (!(await waitUntilGone(identity))) throw new ClaudeProcessPhaseError("停止进程", true)
}

async function signalOwnedProcess(
  identity: RetainedClaudeProcess,
  signal: "SIGTERM" | "SIGKILL",
): Promise<boolean> {
  const current = await readClaudeProcess(identity.pid).catch(() => {
    throw new ClaudeProcessPhaseError("核对进程身份")
  })
  if (!isSameProcess(identity, current)) return false
  try {
    process.kill(identity.pid, signal)
    return true
  } catch (error) {
    if (fileErrorCode(error) === "ESRCH") return false
    throw new ClaudeProcessPhaseError("停止进程")
  }
}

async function waitUntilGone(identity: RetainedClaudeProcess): Promise<boolean> {
  const deadline = performance.now() + waitMs
  let unableToVerify = false
  do {
    try {
      if (!isSameProcess(identity, await readClaudeProcess(identity.pid))) return true
      unableToVerify = false
    } catch {
      // 正在退出的进程可能先失去可执行文件视图，退出或复用仍须由下一次系统读取证实。
      unableToVerify = true
    }
    await setTimeout(50)
  } while (performance.now() < deadline)
  if (unableToVerify) throw new ClaudeProcessPhaseError("核对进程身份")
  return false
}

function isSameProcess(
  identity: RetainedClaudeProcess,
  current: RetainedClaudeProcess | null,
): boolean {
  return (
    current !== null &&
    identity.pid === current.pid &&
    identity.startedAt === current.startedAt &&
    sameExecutable(identity.executable, current.executable)
  )
}

function pidExists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (fileErrorCode(error) === "ESRCH") return false
    throw error
  }
}

async function readLinuxProcess(pid: number): Promise<RetainedClaudeProcess | null> {
  const root = `/proc/${pid}`
  try {
    const first = await linuxBirth(root)
    if (first === null) return null
    // exe 是内核记录的执行文件；和前后两次 stat 配对，不能把重用 PID 读成旧的一代。
    const [executable, boot] = await Promise.all([
      readlink(`${root}/exe`),
      readFile("/proc/sys/kernel/random/boot_id", "utf8"),
    ])
    const latest = await linuxBirth(root)
    if (latest === null) return null
    if (first !== latest || !isAbsolute(executable) || !validBootId(boot.trim()))
      throw new Error("无法核对 Linux 上的 Claude Code 进程")
    return { pid, executable, startedAt: `linux:${boot.trim()}:${first}` }
  } catch (error) {
    if (fileErrorCode(error) === "ENOENT" && (await linuxExited(pid, root))) return null
    throw error
  }
}

async function linuxExited(pid: number, root: string): Promise<boolean> {
  if (!pidExists(pid)) return true
  try {
    // 读取 exe 时进程可能变成 zombie，此时已经不能再执行。
    return (await linuxBirth(root)) === null
  } catch (error) {
    if (fileErrorCode(error) === "ENOENT") return !pidExists(pid)
    throw error
  }
}

async function linuxBirth(root: string): Promise<string | null> {
  const stat = await readFile(`${root}/stat`, "utf8")
  // comm 带括号且可包含空格和右括号；最后一个右括号后才是从第 3 项开始的字段。
  const end = stat.lastIndexOf(")")
  const fields = stat
    .slice(end + 1)
    .trim()
    .split(/\s+/)
  if (end < 0 || fields[0] === undefined || !/^\d+$/.test(fields[19] ?? ""))
    throw new Error("Linux 进程启动信息不可用")
  if (fields[0] === "Z" || fields[0] === "X") return null
  return fields[19] ?? null
}

async function readMacProcess(pid: number): Promise<RetainedClaudeProcess | null> {
  const first = await macBirth(pid)
  if (first === null) return null
  // ps 的 comm 可被 argv[0] 改写，必须与内核的第一个程序文本映射共同核对。
  const [boot, text] = await Promise.all([
    run("/usr/sbin/sysctl", ["-n", "kern.bootsessionuuid"], unixCommandOptions),
    macExecutable(pid).catch((error: unknown) => ({ error })),
  ])
  const latest = await macBirth(pid)
  if (latest === null) return null
  if (text !== null && typeof text !== "string") throw text.error
  if (
    text === null ||
    !validBootId(boot.stdout.trim()) ||
    first.start !== latest.start ||
    first.command !== latest.command ||
    (await realpath(latest.command).catch(() => latest.command)) !== text
  )
    throw new Error("无法核对 macOS 上的 Claude Code 进程")
  return { pid, executable: text, startedAt: `darwin:${boot.stdout.trim()}:${latest.start}` }
}

const unixCommandOptions = {
  encoding: "utf8",
  env: systemEnv,
  timeout: probeTimeoutMs,
  maxBuffer: 64 * 1024,
  windowsHide: true,
} as const

const macStart = /^[A-Za-z]{3} [A-Za-z]{3} \d+ \d{2}:\d{2}:\d{2} \d{4}$/

async function macBirth(pid: number): Promise<{ start: string; command: string } | null> {
  try {
    const { stdout } = await run(
      "/bin/ps",
      ["-ww", "-p", String(pid), "-o", "lstart=", "-o", "stat=", "-o", "comm="],
      unixCommandOptions,
    )
    const match =
      /^([A-Za-z]{3}\s+[A-Za-z]{3}\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(\S+)\s+(.*)$/.exec(
        stdout.trim(),
      )
    const [, start, state, command] = match ?? []
    if (!start || !state || command === undefined) throw new Error("macOS 进程启动信息不可用")
    if (state.startsWith("Z")) return null
    if (!isAbsolute(command)) throw new Error("macOS 进程执行路径不可用")
    return { start: start.replace(/\s+/g, " "), command }
  } catch (error) {
    if (!pidExists(pid)) return null
    throw error
  }
}

async function macExecutable(pid: number): Promise<string | null> {
  try {
    const { stdout } = await run(
      "/usr/sbin/lsof",
      ["-n", "-P", "-a", "-p", String(pid), "-d", "txt", "-F0fn"],
      unixCommandOptions,
    )
    const [owner, executable] = stdout.split(/\0\n/)
    const fields = executable?.split("\0")
    const path = fields?.find((field) => field.startsWith("n"))?.slice(1)
    if (owner !== `p${pid}` || fields?.[0] !== "ftxt" || !path || !isAbsolute(path))
      throw new Error("macOS 进程执行路径不可用")
    return path
  } catch (error) {
    if (!pidExists(pid)) return null
    throw error
  }
}

function validBootId(value: string): boolean {
  return /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value)
}

// 始终用同一进程 handle 读取和终止；脚本固定，路径只作环境数据传入。
const windowsProcessScript = [
  "$ErrorActionPreference = 'Stop'",
  "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
  "$target = Get-Process -Id ([int]$env:PIGCLAUDE_PROCESS_ID) -ErrorAction SilentlyContinue",
  "if ($null -eq $target) { 'released'; exit 0 }",
  "try {",
  "  $null = $target.Handle",
  "  if ($target.HasExited) { 'released'; exit 0 }",
  "  $time = 'win32:' + $target.StartTime.ToUniversalTime().Ticks.ToString([Globalization.CultureInfo]::InvariantCulture)",
  "  if ($env:PIGCLAUDE_PROCESS_STOP -eq '1' -and $time -cne $env:PIGCLAUDE_PROCESS_STARTED) { 'released'; exit 0 }",
  "  $path = [IO.Path]::GetFullPath($target.MainModule.FileName)",
  "  if ($env:PIGCLAUDE_PROCESS_STOP -ne '1') {",
  "    @{ executable = $path; startedAt = $time } | ConvertTo-Json -Compress",
  "    exit 0",
  "  }",
  "  if (-not ([String]::Equals($path, $env:PIGCLAUDE_PROCESS_PATH, [StringComparison]::OrdinalIgnoreCase))) { 'released'; exit 0 }",
  "  try {",
  "    $target.Kill()",
  "    if ($target.WaitForExit(5000)) { 'released' } else { 'stop-timeout' }",
  "  } catch {",
  "    if ($target.HasExited) { 'released' } else { 'stop-failed' }",
  "  }",
  "} catch {",
  "  if ($target.HasExited) { 'released'; exit 0 }",
  "  if ($env:PIGCLAUDE_PROCESS_STOP -eq '1') { 'verify-failed' } else { 'read-failed' }",
  "} finally { $target.Dispose() }",
].join("\n")

async function runWindowsProcess(pid: number, stop?: RetainedClaudeProcess): Promise<string> {
  const phase = stop ? "核对并停止进程" : "读取进程身份"
  const root = process.env.SystemRoot
  if (!root || !win32.isAbsolute(root)) throw new ClaudeProcessPhaseError(phase)
  const env = {
    SystemRoot: root,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    PIGCLAUDE_PROCESS_ID: String(pid),
    PIGCLAUDE_PROCESS_STOP: stop ? "1" : "0",
    PIGCLAUDE_PROCESS_STARTED: stop?.startedAt ?? "",
    PIGCLAUDE_PROCESS_PATH: stop?.executable ?? "",
  }
  try {
    const { stdout } = await run(
      win32.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", windowsProcessScript],
      {
        encoding: "utf8",
        timeout: windowsClaudeProcessTimeoutMs,
        maxBuffer: 64 * 1024,
        windowsHide: true,
        env,
      },
    )
    return stdout.trim()
  } catch (error) {
    // execFile 超时会标记 killed，底层异常还可能包含脚本和本机路径。
    throw new ClaudeProcessPhaseError(phase, isPlainRecord(error) && error.killed === true)
  }
}

async function readWindowsProcess(pid: number): Promise<RetainedClaudeProcess | null> {
  const result = await runWindowsProcess(pid)
  if (result === "released") return null
  if (result === "read-failed") throw new ClaudeProcessPhaseError("读取进程身份")
  const value: unknown = JSON.parse(result)
  if (
    !isPlainRecord(value) ||
    typeof value.executable !== "string" ||
    !isAbsolute(value.executable) ||
    !isClaudeProcessBirth(value.startedAt)
  )
    throw new Error("无法核对 Windows 上的 Claude Code 进程")
  // 保留进程 handle 返回的完整路径，续接时需要用同一个来源再次验证。
  const executable = value.executable
  return { pid, executable, startedAt: value.startedAt }
}
