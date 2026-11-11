// 负责读取电脑名、系统版本和应用版本，并清洗成可以上报的短文本。
import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import { hostname as readHostname } from "node:os"
import { app } from "electron"

/** 首次授权和启动上报共用的脱敏设备属性。 */
export interface DeviceInfo {
  /** 用户可识别的电脑名，长度不超过 64 个字符。 */
  name: string
  /** 系统展示名，例如 macOS 15.4 或 Ubuntu 24.04。 */
  osVersion: string
  /** 当前 PigClaude 版本。 */
  appVersion: string
}

/** 设备属性读取边界，测试可替换系统命令、文件和 Electron 版本。 */
export type DeviceInfoDeps = {
  /** 当前系统平台，默认 process.platform。 */
  platform?: string
  /** Electron 系统版本，默认 process.getSystemVersion。 */
  systemVersion?: () => string
  /** 系统主机名，默认 os.hostname。 */
  hostname?: () => string
  /** 系统电脑名，读取失败返回 null；默认只在 macOS 调用 scutil。 */
  computerName?: (() => Promise<string | null>) | undefined
  /** /etc/os-release 内容，读取失败返回 null；默认读取固定路径。 */
  readOsRelease?: () => Promise<string | null>
  /** 应用版本，默认 Electron app.getVersion。 */
  appVersion?: () => string
}

const DEFAULT_NAME = "PigClaude 电脑"
const MAX_NAME_LENGTH = 64
const MAX_VERSION_LENGTH = 64
const APP_VERSION_PATTERN = /^[0-9A-Za-z.+-]{1,32}$/
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/g

let defaultInfo: Promise<DeviceInfo> | null = null

/** 读取当前设备信息；不传依赖时整个进程只读取一次系统值。 */
export async function readDeviceInfo(deps?: DeviceInfoDeps): Promise<DeviceInfo> {
  if (deps) return loadDeviceInfo(deps)
  defaultInfo ??= loadDeviceInfo({})
  return defaultInfo
}

async function loadDeviceInfo(deps: DeviceInfoDeps): Promise<DeviceInfo> {
  const platform = deps.platform ?? process.platform
  const hostname = cleanText(safeCall(deps.hostname ?? readHostname, ""), MAX_NAME_LENGTH)
  const fallbackName = platform === "darwin" ? stripLocalSuffix(hostname) : hostname
  const computerName = await readComputerName(platform, deps.computerName)
  return {
    name: cleanText(computerName ?? fallbackName, MAX_NAME_LENGTH) || DEFAULT_NAME,
    osVersion: await readOsVersion(platform, deps),
    appVersion: validAppVersion(safeCall(deps.appVersion ?? readAppVersion, "")),
  }
}

/** 只把后端接受的版本号送进授权请求，避免整笔登录被 400 拒绝。 */
function validAppVersion(raw: string): string {
  return APP_VERSION_PATTERN.test(raw) ? raw : "0.0.0"
}

async function readComputerName(
  platform: string,
  readName?: () => Promise<string | null>,
): Promise<string | null> {
  if (readName) {
    try {
      return await readName()
    } catch {
      return null
    }
  }
  if (platform !== "darwin") return null
  return readMacComputerName()
}

function readMacComputerName(): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      execFile(
        "scutil",
        ["--get", "ComputerName"],
        { encoding: "utf8", timeout: 2_000, maxBuffer: 16 * 1024, windowsHide: true, shell: false },
        (error, stdout) => resolve(error ? null : stdout),
      )
    } catch {
      resolve(null)
    }
  })
}

async function readOsVersion(platform: string, deps: DeviceInfoDeps): Promise<string> {
  if (platform === "darwin") {
    const version = readSystemVersion(deps)
    return version ? `macOS ${version}` : "macOS"
  }
  if (platform === "win32") {
    const build = Number.parseInt(readSystemVersion(deps).split(".")[2] ?? "", 10)
    return Number.isFinite(build) && build >= 22_000 ? "Windows 11" : "Windows 10"
  }
  if (platform === "linux") {
    const raw = await readOsReleaseText(deps.readOsRelease)
    return readLinuxLabel(raw) || "Linux"
  }
  return readSystemVersion(deps) || "Linux"
}

function readSystemVersion(deps: DeviceInfoDeps): string {
  const systemVersion = deps.systemVersion ?? (() => process.getSystemVersion())
  return cleanText(safeCall(systemVersion, ""), MAX_VERSION_LENGTH)
}

async function readOsReleaseText(read?: () => Promise<string | null>): Promise<string | null> {
  try {
    return await (read ?? (() => readFile("/etc/os-release", "utf8")))()
  } catch {
    return null
  }
}

function readLinuxLabel(raw: string | null): string {
  if (!raw) return ""
  const values = new Map<string, string>()
  for (const line of raw.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (match?.[1]) values.set(match[1], unquote(match[2] ?? ""))
  }
  const name = cleanText(values.get("NAME") ?? "", MAX_VERSION_LENGTH)
  const version = cleanText(values.get("VERSION_ID") ?? "", MAX_VERSION_LENGTH)
  return cleanText([name, version].filter(Boolean).join(" "), MAX_VERSION_LENGTH)
}

function unquote(value: string): string {
  const quoted =
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  return quoted ? value.slice(1, -1) : value
}

function readAppVersion(): string {
  const electronApp: { getVersion?: () => string } | undefined = app
  return electronApp?.getVersion?.() ?? ""
}

function stripLocalSuffix(value: string): string {
  return value.trim().replace(/\.local$/i, "")
}

function cleanText(value: string, maxLength: number): string {
  return [...value.replace(CONTROL_CHARACTERS, "").trim()].slice(0, maxLength).join("")
}

function safeCall<T>(read: () => T, fallback: T): T {
  try {
    return read()
  } catch {
    return fallback
  }
}
