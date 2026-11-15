// 校验本地能力插件归档的哈希，再以只读方式取得包内的文件正文。

import { createHash } from "node:crypto"
import { constants } from "node:fs"
import { open } from "node:fs/promises"
import {
  pluginArchiveError,
  PluginArchiveEntries,
  PluginArchiveError,
  pluginArchiveLimits,
} from "./plugin-archive-entries"
import { readPluginTar } from "./plugin-archive-tar"
import { readPluginZip } from "./plugin-archive-zip"

/** 归档边界返回给安装程序的固定错误码。 */
export { PluginArchiveError, type PluginArchiveErrorCode } from "./plugin-archive-entries"

/** 校验实际解析的同一份归档字节，仅返回 zip/tgz 中相对于包根的普通文件。 */
export async function readCapabilityPluginArchive(
  path: string,
  sha256: string,
): Promise<ReadonlyMap<string, Buffer>> {
  if (typeof sha256 !== "string" || sha256.length !== 64 || !/^[0-9a-f]{64}$/i.test(sha256))
    throw new PluginArchiveError("PLUGIN_ARCHIVE_SHA256_INVALID")
  try {
    const bytes = await readArchive(path)
    if (createHash("sha256").update(bytes).digest("hex") !== sha256.toLowerCase())
      throw new PluginArchiveError("PLUGIN_ARCHIVE_SHA256_MISMATCH")
    const entries = new PluginArchiveEntries()
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) await readPluginTar(bytes, entries)
    else await readPluginZip(bytes, entries)
    return entries.finish()
  } catch (error) {
    throw pluginArchiveError(error)
  }
}

async function readArchive(path: string): Promise<Buffer> {
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK)
  try {
    const stat = await file.stat()
    if (!stat.isFile()) throw new PluginArchiveError("PLUGIN_ARCHIVE_INVALID")
    if (stat.size > pluginArchiveLimits.inputBytes)
      throw new PluginArchiveError("PLUGIN_ARCHIVE_TOO_LARGE")
    const bytes = Buffer.alloc(stat.size)
    let position = 0
    while (position < bytes.length) {
      const { bytesRead } = await file.read(bytes, position, bytes.length - position, position)
      if (bytesRead === 0) throw new PluginArchiveError("PLUGIN_ARCHIVE_INVALID")
      position += bytesRead
    }
    if ((await file.read(Buffer.alloc(1), 0, 1, position)).bytesRead !== 0)
      throw new PluginArchiveError("PLUGIN_ARCHIVE_INVALID")
    return bytes
  } finally {
    await file.close()
  }
}
