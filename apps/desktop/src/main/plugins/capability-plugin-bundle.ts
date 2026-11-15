// 将开发目录或现成归档的清单和 ES 模块读入有界快照，安装期间不执行插件代码。

import { constants } from "node:fs"
import { open, readdir, realpath, stat } from "node:fs/promises"
import { join, relative } from "node:path"
import {
  capabilityPluginManifestFile,
  type CapabilityPluginManifest,
} from "../../capability-plugin-contract"
import { validateCapabilityPluginManifest } from "./capability-plugin-manifest"
import { isCapabilityPluginModulePath } from "./capability-plugin-paths"

const manifestLimit = 256 * 1024
const moduleLimit = 2 * 1024 * 1024
const bundleLimit = 16 * 1024 * 1024
const moduleCountLimit = 256
const directoryEntryLimit = 2_048
const decoder = new TextDecoder("utf-8", { fatal: true })

/** 安装前已校验的清单与模块正文，与原文件夹或归档不再共享引用。 */
export type CapabilityPluginBundle = {
  manifest: CapabilityPluginManifest
  modules: Readonly<Record<string, string>>
}

function wanted(path: string): boolean {
  return path === capabilityPluginManifestFile || /\.m?js$/i.test(path)
}

/** 只读取包内普通文件。开发目录中已有的依赖缓存与 Git 元数据不会进入安装副本。 */
export async function readCapabilityPluginDirectory(
  path: string,
): Promise<ReadonlyMap<string, Buffer>> {
  const files = new Map<string, Buffer>()
  let remainingEntries = directoryEntryLimit
  let total = 0
  try {
    const root = await realpath(path)
    if (!(await stat(root)).isDirectory()) throw new Error("PLUGIN_BUNDLE_INVALID")
    async function visit(prefix: string): Promise<void> {
      const directory = join(root, prefix)
      if (relative(directory, await realpath(directory)) !== "")
        throw new Error("PLUGIN_BUNDLE_UNSAFE")
      const entries = await readdir(directory, { withFileTypes: true })
      remainingEntries -= entries.length
      if (remainingEntries < 0) throw new Error("PLUGIN_BUNDLE_TOO_LARGE")
      for (const entry of entries) {
        if (entry.name === "node_modules" || entry.name === ".git") continue
        const name = prefix ? prefix + "/" + entry.name : entry.name
        if (entry.isSymbolicLink()) throw new Error("PLUGIN_BUNDLE_UNSAFE")
        if (entry.isDirectory()) {
          await visit(name)
        } else if (wanted(name)) {
          if (!entry.isFile()) throw new Error("PLUGIN_BUNDLE_UNSAFE")
          const content = await readRegularFile(
            join(root, name),
            name === capabilityPluginManifestFile ? manifestLimit : moduleLimit,
          )
          total += content.length
          if (total > bundleLimit + manifestLimit || files.size >= moduleCountLimit + 1)
            throw new Error("PLUGIN_BUNDLE_TOO_LARGE")
          files.set(name, content)
        }
      }
    }
    await visit("")
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      ["PLUGIN_BUNDLE_INVALID", "PLUGIN_BUNDLE_UNSAFE", "PLUGIN_BUNDLE_TOO_LARGE"].includes(
        error.message,
      )
    )
      throw error
    throw new Error("PLUGIN_BUNDLE_INVALID")
  }
  return files
}

/** 解析清单、入口和模块名，检查跨平台同名冲突与资源限额。 */
export function validateCapabilityPluginBundle(
  files: ReadonlyMap<string, Buffer>,
  appVersion: string,
): CapabilityPluginBundle {
  const manifestBytes = files.get(capabilityPluginManifestFile)
  if (manifestBytes === undefined) throw new Error("PLUGIN_MANIFEST_INVALID")
  if (manifestBytes.length > manifestLimit) throw new Error("PLUGIN_BUNDLE_TOO_LARGE")
  let value: unknown
  try {
    value = JSON.parse(decoder.decode(manifestBytes))
  } catch {
    throw new Error("PLUGIN_MANIFEST_INVALID")
  }
  const manifest = validateCapabilityPluginManifest(value, appVersion)
  const modules = new Map<string, string>()
  const names = new Map<string, { path: string; file: boolean }>()
  let total = 0
  for (const [path, bytes] of files) {
    if (path === capabilityPluginManifestFile || !wanted(path)) continue
    if (!isCapabilityPluginModulePath(path)) throw new Error("PLUGIN_BUNDLE_UNSAFE")
    checkPath(path, names)
    total += bytes.length
    if (bytes.length > moduleLimit || total > bundleLimit || modules.size >= moduleCountLimit)
      throw new Error("PLUGIN_BUNDLE_TOO_LARGE")
    try {
      modules.set(path, decoder.decode(bytes))
    } catch {
      throw new Error("PLUGIN_BUNDLE_INVALID")
    }
  }
  if (!modules.has(manifest.entry)) throw new Error("PLUGIN_BUNDLE_INVALID")
  return { manifest, modules: Object.fromEntries(modules) }
}

function checkPath(path: string, names: Map<string, { path: string; file: boolean }>): void {
  const parts = path.split("/")
  for (let count = 1; count <= parts.length; count += 1) {
    const prefix = parts.slice(0, count).join("/")
    const key = prefix.toLowerCase()
    const file = count === parts.length
    const earlier = names.get(key)
    if (earlier && (earlier.path !== prefix || earlier.file !== file))
      throw new Error("PLUGIN_BUNDLE_UNSAFE")
    names.set(key, { path: prefix, file })
  }
}

async function readRegularFile(path: string, limit: number): Promise<Buffer> {
  if (relative(path, await realpath(path)) !== "") throw new Error("PLUGIN_BUNDLE_UNSAFE")
  const handle = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
  )
  try {
    const info = await handle.stat()
    const resolved = await realpath(path)
    const observed = await stat(resolved)
    if (
      !info.isFile() ||
      relative(path, resolved) !== "" ||
      info.dev !== observed.dev ||
      info.ino !== observed.ino
    )
      throw new Error("PLUGIN_BUNDLE_UNSAFE")
    if (info.size > limit) throw new Error("PLUGIN_BUNDLE_TOO_LARGE")
    const bytes = Buffer.alloc(info.size + 1)
    let used = 0
    while (used < bytes.length) {
      const { bytesRead } = await handle.read(bytes, used, bytes.length - used, null)
      if (bytesRead === 0) break
      used += bytesRead
    }
    if (used !== info.size) throw new Error("PLUGIN_BUNDLE_INVALID")
    return bytes.subarray(0, used)
  } finally {
    await handle.close()
  }
}
