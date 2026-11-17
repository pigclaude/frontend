// 为插件市场读取规范来源、目录与可验证的安装包。

import { createHash } from "node:crypto"
import { realpath } from "node:fs/promises"
import { join } from "node:path"
import type { PluginMarketplaceSourceInput } from "../../plugin-marketplace-contract"
import { readCanonicalPluginDirectory } from "./claude-code-plugin-source"
import { PluginArchiveError } from "./plugin-archive"
import { readBoundedPluginFile } from "./plugin-bounded-file"
import type {
  PluginMarketplaceCatalog,
  PluginMarketplaceCatalogEntry,
  PluginMarketplaceLoadedEntry,
} from "./plugin-marketplace-catalog"
import { loadMarketplaceArchive } from "./plugin-marketplace-download"
import {
  parsePluginMarketplaceCatalog,
  pluginMarketplaceCatalogBytesLimit,
} from "./plugin-marketplace-parser"
import {
  normalizeMarketplaceChecksum,
  normalizeMarketplaceRelativePath,
  normalizePluginMarketplaceSource,
} from "./plugin-marketplace-source-input"

/** 只校验和规范化来源，不读取文件或联网。 */
export { normalizePluginMarketplaceSource } from "./plugin-marketplace-source-input"

/** 单独解析目录字节，供验证签名的调用者在验证后使用同一份数据。 */
export { parsePluginMarketplaceCatalog } from "./plugin-marketplace-parser"

type PluginFiles = ReadonlyMap<string, Buffer>
const catalogFile = ".claude-plugin/marketplace.json"
const signatureFile = catalogFile + ".sig"

/** 从规范来源读取市场目录。 */
export async function loadPluginMarketplaceCatalog(
  input: PluginMarketplaceSourceInput,
  fetcher: typeof fetch = fetch,
): Promise<PluginMarketplaceCatalog> {
  return parsePluginMarketplaceCatalog(await loadPluginMarketplaceCatalogBytes(input, fetcher))
}

/** 返回原始目录字节，保持空白和原编码，方便独立验证分离签名。 */
export async function loadPluginMarketplaceCatalogBytes(
  input: PluginMarketplaceSourceInput,
  fetcher: typeof fetch = fetch,
): Promise<Buffer> {
  const source = normalizePluginMarketplaceSource(input)
  if (source.kind === "directory") {
    try {
      const root = await realpath(source.path)
      return await readBoundedPluginFile(
        join(root, catalogFile),
        pluginMarketplaceCatalogBytesLimit,
        true,
      )
    } catch {
      throw unavailable()
    }
  }
  const { files } = await loadMarketplaceArchive(source, fetcher)
  const bytes = files.get(catalogFile)
  if (!bytes) throw unavailable()
  if (bytes.byteLength > pluginMarketplaceCatalogBytesLimit)
    throw new Error("PLUGIN_MARKETPLACE_CATALOG_INVALID")
  return bytes
}

/** 读取市场条目指向的包及实际校验结果。 */
export async function loadPluginMarketplaceEntry(
  input: PluginMarketplaceSourceInput,
  entry: PluginMarketplaceCatalogEntry,
  fetcher: typeof fetch = fetch,
): Promise<PluginMarketplaceLoadedEntry> {
  const source = normalizePluginMarketplaceSource(input)
  const expected =
    entry.expectedSha256 === null ? null : normalizeMarketplaceChecksum(entry.expectedSha256)
  if (entry.source.kind === "relative")
    return loadRelativeEntry(
      source,
      normalizeMarketplaceRelativePath(entry.source.path),
      expected,
      fetcher,
    )

  const pinned = entry.source.kind === "github-subdir" ? entry.source : null
  const directory = pinned ? normalizeMarketplaceRelativePath(pinned.path).slice(2) : null
  const selected = normalizePluginMarketplaceSource(
    pinned ? { ...pinned, kind: "github" } : entry.source,
  )
  if (selected.kind === "directory") throw unavailable()
  const { files, sha256 } = await loadMarketplaceArchive(selected, fetcher, expected)
  return loadedEntry(selected, directory === null ? files : selectFiles(files, directory), sha256)
}

async function loadRelativeEntry(
  source: PluginMarketplaceSourceInput,
  path: string,
  expected: string | null,
  fetcher: typeof fetch,
): Promise<PluginMarketplaceLoadedEntry> {
  const relative = path.slice(2)
  let entry: PluginMarketplaceLoadedEntry
  if (source.kind === "directory") {
    try {
      const root = await realpath(source.path)
      const folder = join(root, relative)
      const files = await readCanonicalPluginDirectory(folder)
      entry = loadedEntry(source, relative === "" ? rootPluginFiles(files) : files, null)
    } catch {
      throw new Error("PLUGIN_MARKETPLACE_ENTRY_UNAVAILABLE")
    }
  } else {
    const { files, sha256 } = await loadMarketplaceArchive(source, fetcher)
    const selected = selectFiles(files, relative)
    entry = loadedEntry(source, selected, sha256)
  }
  if (expected !== null && expected !== entry.digest)
    throw new PluginArchiveError("PLUGIN_ARCHIVE_SHA256_MISMATCH")
  return entry
}

function selectFiles(files: PluginFiles, relative: string): PluginFiles {
  if (relative === "") return rootPluginFiles(files)
  const prefix = relative + "/"
  return new Map(
    [...files].flatMap(([path, bytes]) =>
      path.startsWith(prefix) ? [[path.slice(prefix.length), bytes] as const] : [],
    ),
  )
}

function rootPluginFiles(files: PluginFiles): PluginFiles {
  const selected = new Map(files)
  // 根插件的指纹不读取它所在市场的目录和签名，避免目录引用自己的摘要。
  selected.delete(catalogFile)
  selected.delete(signatureFile)
  return selected
}

function loadedEntry(
  source: PluginMarketplaceSourceInput,
  files: PluginFiles,
  archiveSha256: string | null,
): PluginMarketplaceLoadedEntry {
  if (files.size === 0) throw new Error("PLUGIN_MARKETPLACE_ENTRY_UNAVAILABLE")
  return {
    files,
    digest: fileTableDigest(files),
    archiveSha256,
    repo: source.kind === "github" ? source.repo : null,
    commit: source.kind === "github" ? source.commit : null,
  }
}

function fileTableDigest(files: PluginFiles): string {
  const hash = createHash("sha256").update("pigclaude-plugin-files-v1\0")
  const entries = [...files].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  for (const [path, bytes] of entries) {
    const name = Buffer.from(path, "utf8")
    const lengths = Buffer.alloc(8)
    lengths.writeUInt32BE(name.byteLength)
    lengths.writeUInt32BE(bytes.byteLength, 4)
    hash.update(lengths).update(name).update(bytes)
  }
  return hash.digest("hex")
}

function unavailable(): Error {
  return new Error("PLUGIN_MARKETPLACE_SOURCE_UNAVAILABLE")
}
