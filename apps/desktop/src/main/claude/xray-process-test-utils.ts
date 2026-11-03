// 识别本次测试守护进程直接启动的 Xray，避免影响其他进程。

import { execFileSync } from "node:child_process"
import { basename } from "node:path"

/** 返回指定守护进程的唯一 Xray 子进程；无法确认身份时拒绝操作。 */
export function findTestXrayProcess(watchdogPid: number, binaryPath: string): number {
  if (!Number.isInteger(watchdogPid) || watchdogPid <= 0) throw new Error("守护进程身份无效")
  const output =
    process.platform === "win32"
      ? execFileSync(
          "powershell.exe",
          [
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            `Get-CimInstance Win32_Process -Filter 'ParentProcessId = ${watchdogPid}' | Where-Object { $_.Name -eq $env:PIGCLAUDE_TEST_XRAY_PROCESS_NAME } | Select-Object -ExpandProperty ProcessId`,
          ],
          {
            encoding: "utf8",
            env: { ...process.env, PIGCLAUDE_TEST_XRAY_PROCESS_NAME: basename(binaryPath) },
            timeout: 10_000,
          },
        )
      : execFileSync("pgrep", ["-P", String(watchdogPid), "-f", binaryPath], {
          encoding: "utf8",
          timeout: 10_000,
        })
  const matches = output.trim().split(/\s+/).map(Number)
  const pid = matches[0]
  if (matches.length !== 1 || pid === undefined || !Number.isInteger(pid) || pid <= 0) {
    throw new Error("无法确认本次 Xray 进程")
  }
  return pid
}

/** 检查测试进程是否仍存在，不发送终止信号。 */
export function testProcessExists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") return false
    throw error
  }
}

/** 核对 Windows 测试专用程序路径后，结束该进程并等待退出。 */
export function stopTestXray(pid: number, binaryPath: string): void {
  if (!Number.isInteger(pid) || pid <= 0) throw new Error("测试进程身份无效")
  if (!testProcessExists(pid)) return
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$process = Get-Process -Id ${pid} -ErrorAction SilentlyContinue`,
    "if ($null -eq $process) { exit 0 }",
    "$handle = $process.Handle",
    "if ($process.MainModule.FileName -ne $env:PIGCLAUDE_TEST_XRAY_PATH) { throw '进程身份不匹配' }",
    "$process.Kill()",
    "if (!$process.WaitForExit(5000)) { throw '测试进程未退出' }",
    "$process.Dispose()",
  ].join("; ")
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    env: { ...process.env, PIGCLAUDE_TEST_XRAY_PATH: binaryPath },
    timeout: 10_000,
  })
}
