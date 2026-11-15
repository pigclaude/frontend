// 在有界的 gzip 解压结果中读取 tar 条目，只从解析器获得内存中的普通文件和目录。

import { promisify } from "node:util"
import { gunzip } from "node:zlib"
import { Parser, type ReadEntry } from "tar"
import {
  PluginArchiveError,
  pluginArchiveError,
  pluginArchiveLimits,
  type PluginArchiveEntries,
} from "./plugin-archive-entries"

const decompress = promisify(gunzip)
const blockBytes = 512

/** 读取经过哈希验证的 tgz。启用 tar 的严格头校验与 PAX 解析，忽略条目也会使包无效。 */
export async function readPluginTar(bytes: Buffer, entries: PluginArchiveEntries): Promise<void> {
  const archive = await decompress(bytes, { maxOutputLength: pluginArchiveLimits.expandedBytes })
  if (
    archive.length < blockBytes * 2 ||
    archive.length % blockBytes !== 0 ||
    !archive.subarray(-blockBytes * 2).every((byte) => byte === 0) ||
    (archive[0] === 0x1f && archive[1] === 0x8b)
  )
    throw new PluginArchiveError("PLUGIN_ARCHIVE_INVALID")

  await new Promise<void>((resolve, reject) => {
    const parser = new Parser({
      strict: true,
      maxMetaEntrySize: 64 * 1024,
      brotli: false,
      zstd: false,
    })
    const fail = (error: unknown): void => {
      const failure = pluginArchiveError(error)
      reject(failure)
      parser.abort(new Error(failure.message))
    }
    parser.once("error", reject)
    parser.once("end", resolve)
    parser.on("ignoredEntry", () => fail(new PluginArchiveError("PLUGIN_ARCHIVE_UNSAFE")))
    parser.on("meta", () => {
      try {
        entries.countRecord()
      } catch (error) {
        fail(error)
      }
    })
    parser.on("entry", (entry: ReadEntry) => {
      try {
        const directory = entry.type === "Directory"
        if ((!directory && entry.type !== "File" && entry.type !== "OldFile") || entry.linkpath)
          throw new PluginArchiveError("PLUGIN_ARCHIVE_UNSAFE")
        const path = entries.reserve(entry.path, directory, entry.size)
        if (path !== null) saveEntry(entries, entry, path, fail)
        entry.resume()
      } catch (error) {
        fail(error)
      }
    })
    parser.end(archive)
  })
}

function saveEntry(
  entries: PluginArchiveEntries,
  entry: ReadEntry,
  path: string,
  fail: (error: unknown) => void,
): void {
  const chunks: Buffer[] = []
  entry.on("data", (chunk: Buffer) => chunks.push(chunk))
  entry.once("end", () => {
    try {
      entries.save(path, entry.size, Buffer.concat(chunks))
    } catch (error) {
      fail(error)
    }
  })
}
