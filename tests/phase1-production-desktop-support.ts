// 负责生产桌面启动的最小环境、真实门禁与私密输入隔离，不启动任何真实进程。
import { readFile, stat } from "node:fs/promises"

const osKeys = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "DISPLAY",
  "WAYLAND_DISPLAY",
  "XDG_RUNTIME_DIR",
  "DBUS_SESSION_BUS_ADDRESS",
  "SystemRoot",
  "WINDIR",
  "APPDATA",
  "LOCALAPPDATA",
]

/** 仅复制明确的正常 OS 环境和公开端点，未知变量默认拒绝。 */
export function desktopEnvironment(
  source: NodeJS.ProcessEnv,
  userData: string,
  rustUrl: string,
  homeUrl: string,
): Record<string, string> {
  const environment: Record<string, string> = {}
  for (const key of osKeys) {
    const value = source[key]
    if (value !== undefined) environment[key] = value
  }
  return {
    ...environment,
    PIGCLAUDE_USER_DATA: userData,
    PIGCLAUDE_RUST_BASE_URL: rustUrl,
    PIGCLAUDE_AUTH_ORIGIN: homeUrl,
  }
}

/** 要求 root 明确提供 Task7 放行及最终镜像来源，缺少时禁止进入真实运行。 */
export function requireProductionDesktopGate(): void {
  if (
    process.env["PIGCLAUDE_TASK7_GATE"] !== "PASS" ||
    !/^[a-f0-9]{40}$/.test(process.env["PIGCLAUDE_PUBLIC_SOURCE_SHA"] ?? "")
  )
    throw new Error("Task7真实放行及公网source checkpoint尚未提供")
}

/** 只在验收控制进程读取独立权限受限文件，不把路径或内容传给 Electron。 */
export async function desktopPrivateInputs(): Promise<{
  email: string
  password: string
  adminAccount: string
  adminPassword: string
  planId: string
}> {
  const path = process.env["PIGCLAUDE_DESKTOP_INPUT_FILE"]
  if (!path) throw new Error("缺少桌面验收独立私密输入文件")
  const metadata = await stat(path)
  if (!metadata.isFile() || (metadata.mode & 0o077) !== 0)
    throw new Error("桌面验收输入必须为权限0600的普通文件")
  let value: unknown
  try {
    value = JSON.parse(await readFile(path, "utf8")) as unknown
  } catch {
    throw new Error("桌面验收私密输入读取失败")
  }
  if (typeof value !== "object" || value === null) throw new Error("桌面验收输入格式无效")
  const input = value as Record<string, unknown>
  const keys = ["email", "password", "adminAccount", "adminPassword", "planId"] as const
  for (const key of keys) {
    if (typeof input[key] !== "string" || input[key].length === 0)
      throw new Error("桌面验收输入字段不完整")
  }
  return input as Awaited<ReturnType<typeof desktopPrivateInputs>>
}
