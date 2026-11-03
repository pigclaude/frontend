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
