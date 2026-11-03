// 负责核对随包或显式指定的原生程序格式与系统、CPU 架构是否匹配。

import { constants } from "node:fs"
import { access, open } from "node:fs/promises"
import { createRequire } from "node:module"
import { machine } from "node:os"
import { fileURLToPath } from "node:url"

/** 结合当前应用的转译状态和系统机器类型识别宿主架构；无法识别时返回空字符串。 */
export function runtimeHostArch(translated?: boolean): string {
  translated ??= electronTranslation()
  if (translated === undefined) return ""
  if (translated) return "arm64"
  const detected = (
    process.platform === "win32" ? (process.env["PROCESSOR_ARCHITEW6432"] ?? machine()) : machine()
  ).toLowerCase()
  if (detected === "amd64" || detected === "x86_64" || detected === "x64") return "x64"
  if (detected === "arm64" || detected === "aarch64") return "arm64"
  return ""
}

function electronTranslation(): boolean | undefined {
  if (process.versions.electron === undefined) {
    if (["darwin", "win32"].includes(process.platform) && process.arch === "x64") return undefined
    return false
  }
  if (!["darwin", "win32"].includes(process.platform)) {
    return false
  }
  try {
    const anchor = typeof __filename === "string" ? __filename : fileURLToPath(import.meta.url)
    const electron: unknown = createRequire(anchor)("electron")
    if (typeof electron !== "object" || electron === null || !("app" in electron)) return undefined
    const app = electron.app
    if (typeof app !== "object" || app === null || !("runningUnderARM64Translation" in app)) {
      return undefined
    }
    const value = app.runningUnderARM64Translation
    return typeof value === "boolean" ? value : undefined
  } catch {
    return undefined
  }
}

/** 仅接受可执行且包含目标系统与架构的原生二进制，不启动待检查程序。 */
export async function matchesRuntimeBinary(
  path: string,
  platform: NodeJS.Platform,
  arch: string,
): Promise<boolean> {
  if (arch !== "x64" && arch !== "arm64") return false
  try {
    await access(path, constants.X_OK)
    const file = await open(path, "r")
    try {
      const header = Buffer.alloc(4096)
      const { bytesRead } = await file.read(header, 0, header.length, 0)
      const bytes = header.subarray(0, bytesRead)
      if (platform === "darwin") return matchesMachO(bytes, arch)
      if (platform === "linux") return matchesElf(bytes, arch)
      if (platform === "win32") {
        if (bytes.length < 64 || bytes.toString("ascii", 0, 2) !== "MZ") return false
        const offset = bytes.readUInt32LE(0x3c)
        if (offset > 1_048_576) return false
        const pe = Buffer.alloc(6)
        const result = await file.read(pe, 0, pe.length, offset)
        return (
          result.bytesRead === pe.length &&
          pe.toString("ascii", 0, 4) === "PE\0\0" &&
          pe.readUInt16LE(4) === (arch === "x64" ? 0x8664 : 0xaa64)
        )
      }
      return false
    } finally {
      await file.close()
    }
  } catch {
    return false
  }
}

function matchesElf(bytes: Buffer, arch: string): boolean {
  if (
    bytes.length < 20 ||
    !bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) ||
    bytes[4] !== 2 ||
    bytes[5] !== 1
  ) {
    return false
  }
  return bytes.readUInt16LE(18) === (arch === "x64" ? 62 : 183)
}

function matchesMachO(bytes: Buffer, arch: string): boolean {
  if (bytes.length < 8) return false
  const cpu = arch === "x64" ? 0x01000007 : 0x0100000c
  if (bytes.readUInt32LE(0) === 0xfeedfacf) return bytes.readUInt32LE(4) === cpu
  const magic = bytes.readUInt32BE(0)
  if (magic !== 0xcafebabe && magic !== 0xcafebabf) return false
  const stride = magic === 0xcafebabf ? 32 : 20
  const count = bytes.readUInt32BE(4)
  if (count > 64 || 8 + count * stride > bytes.length) return false
  for (let index = 0; index < count; index += 1) {
    if (bytes.readUInt32BE(8 + index * stride) === cpu) return true
  }
  return false
}
