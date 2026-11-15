// 校验同一份本地或下载归档的哈希，再以只读方式取得包内文件。

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
  const hash = archiveChecksum(sha256)
  try {
    return (await readPluginArchiveBytes(await readArchive(path), hash)).files
  } catch (error) {
    throw pluginArchiveError(error)
  }
}

/** 先校验实际字节的限额和可选摘要，再解包；同一摘要可作为下载来源证据。 */
export async function readPluginArchiveBytes(
  bytes: Buffer,
  expectedSha256: string | null,
): Promise<{ files: ReadonlyMap<string, Buffer>; sha256: string }> {
  const expected = expectedSha256 === null ? null : archiveChecksum(expectedSha256)
  try {
    if (bytes.length > pluginArchiveLimits.inputBytes)
      throw new PluginArchiveError("PLUGIN_ARCHIVE_TOO_LARGE")
    const sha256 = createHash("sha256").update(bytes).digest("hex")
    if (expected !== null && sha256 !== expected)
      throw new PluginArchiveError("PLUGIN_ARCHIVE_SHA256_MISMATCH")
    const entries = new PluginArchiveEntries()
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) await readPluginTar(bytes, entries)
    else await readPluginZip(bytes, entries)
    return { files: entries.finish(), sha256 }
  } catch (error) {
    throw pluginArchiveError(error)
  }
}

function archiveChecksum(value: string): string {
  if (typeof value !== "string" || value.length !== 64 || !/^[0-9a-f]{64}$/i.test(value))
    throw new PluginArchiveError("PLUGIN_ARCHIVE_SHA256_INVALID")
  return value.toLowerCase()
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
