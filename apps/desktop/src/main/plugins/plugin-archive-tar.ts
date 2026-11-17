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

/** 严格读取 tgz；固定 GitHub 归档可丢弃仓库根的 AGENTS.md 文档链接。 */
export async function readPluginTar(
  bytes: Buffer,
  entries: PluginArchiveEntries,
  githubRoot?: string,
): Promise<void> {
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
        if (
          githubRoot &&
          entry.type === "SymbolicLink" &&
          entry.size === 0 &&
          entry.path.toLowerCase() === githubRoot + "/agents.md" &&
          entry.linkpath === "CLAUDE.md"
        ) {
          // 保留路径冲突和条目计数检查，链接及目标均不因这个条目进入文件表。
          entries.reserve(entry.path, false, 0)
          entry.resume()
          return
        }
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
