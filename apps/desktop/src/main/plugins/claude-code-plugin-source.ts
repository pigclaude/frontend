// 让本地开发目录复用插件归档的相对路径、包根与读取限额。

import { lstat, opendir, realpath, stat } from "node:fs/promises"
import { join, relative } from "node:path"
import { PluginArchiveEntries, PluginArchiveError } from "./plugin-archive-entries"
import { readBoundedPluginFile } from "./plugin-bounded-file"

const ignoredDirectoryEntries = new Set([".git", "node_modules"])

/** 读出普通文件的有界快照，与归档解包后的文件表采用相同规范。 */
export async function readClaudeCodePluginDirectory(
  path: string,
): Promise<ReadonlyMap<string, Buffer>> {
  try {
    const root = await realpath(path)
    return await readCanonicalPluginDirectory(root)
  } catch (error) {
    throw bundleError(error)
  }
}

/** 读取宿主已经定位好的目录；路径在读取前变为链接时会拒绝。 */
export async function readCanonicalPluginDirectory(
  root: string,
): Promise<ReadonlyMap<string, Buffer>> {
  const output = new PluginArchiveEntries()
  try {
    if (!(await stat(root)).isDirectory()) throw new Error("PLUGIN_BUNDLE_INVALID")
    await readDirectory(root, "", output)
    return output.finish()
  } catch (error) {
    throw bundleError(error)
  }
}

/** 校验调用方提供的文件表，包括解包后的路径、大小及跨平台冲突。 */
export function validateClaudeCodePluginFiles(
  files: ReadonlyMap<string, Buffer>,
): ReadonlyMap<string, Buffer> {
  const output = new PluginArchiveEntries()
  try {
    for (const [path, bytes] of files) {
      const name = output.reserve(path, false, bytes.length)
      if (name === null) throw new Error("PLUGIN_BUNDLE_INVALID")
      output.save(name, bytes.length, bytes)
    }
    return output.finish()
  } catch (error) {
    throw bundleError(error)
  }
}

async function readDirectory(
  directory: string,
  prefix: string,
  output: PluginArchiveEntries,
): Promise<void> {
  if (relative(directory, await realpath(directory)) !== "") throw new Error("PLUGIN_BUNDLE_UNSAFE")
  for await (const entry of await opendir(directory)) {
    if (ignoredDirectoryEntries.has(entry.name.toLowerCase())) continue
    const path = join(directory, entry.name)
    const name = prefix ? prefix + "/" + entry.name : entry.name
    if (entry.name.includes("\\") || (!entry.isDirectory() && !entry.isFile()))
      throw new Error("PLUGIN_BUNDLE_UNSAFE")
    if (entry.isDirectory()) {
      output.reserve(name, true, 0)
      await readDirectory(path, name, output)
    } else {
      const file = await lstat(path)
      if (!file.isFile() || file.nlink > 1) throw new Error("PLUGIN_BUNDLE_UNSAFE")
      const relativeName = output.reserve(name, false, file.size)
      if (relativeName === null) throw new Error("PLUGIN_BUNDLE_INVALID")
      output.save(relativeName, file.size, await readBoundedPluginFile(path, file.size, true))
    }
  }
}

function bundleError(error: unknown): Error {
  if (error instanceof PluginArchiveError)
    return new Error(error.code.replace("PLUGIN_ARCHIVE_", "PLUGIN_BUNDLE_"))
  if (
    error instanceof Error &&
    ["PLUGIN_BUNDLE_INVALID", "PLUGIN_BUNDLE_UNSAFE", "PLUGIN_BUNDLE_TOO_LARGE"].includes(
      error.message,
    )
  )
    return error
  return new Error("PLUGIN_BUNDLE_INVALID")
}
