// 将 Claude Code 市场 JSON 中的可展示字段与经过校验的来源分开保存。

import { z } from "zod"
import { isCapabilityPluginId } from "./capability-plugin-paths"
import { normalizePluginNetworkDomain } from "./plugin-network-domains"
import type {
  PluginMarketplaceCatalog,
  PluginMarketplaceCatalogEntry,
  PluginMarketplaceEntrySource,
} from "./plugin-marketplace-catalog"
import {
  marketplaceRecord,
  normalizeMarketplaceChecksum,
  normalizeMarketplaceRelativePath,
  normalizePluginMarketplaceSource,
} from "./plugin-marketplace-source-input"

/** 市场 JSON 在解码和解析之前最多读取 1 MiB。 */
export const pluginMarketplaceCatalogBytesLimit = 1024 * 1024
const decoder = new TextDecoder("utf-8", { fatal: true })
const label = z.string().trim().min(1).max(256)
const unsupportedSources = new Set(["npm", "command", "url", "git", "git-subdir"])
const entry = z.object({
  name: z.string().refine(isCapabilityPluginId),
  displayName: label.optional(),
  source: z.unknown(),
  description: z.string().max(4096).optional(),
  version: label.optional(),
  author: z.union([label, z.object({ name: label })]).optional(),
  pigclaude: z
    .object({
      kind: z.enum(["capability", "claude-code"]).optional(),
      sha256: z.string().optional(),
      permissions: z.array(label).max(64).optional(),
      domains: z.array(label).max(64).optional(),
    })
    .optional(),
})
const catalog = z.object({ name: label, plugins: z.array(z.unknown()).max(2048) })

/** 解析原始目录字节；目录公告不会授予包运行权限或官方审核状态。 */
export function parsePluginMarketplaceCatalog(bytes: Uint8Array): PluginMarketplaceCatalog {
  try {
    if (bytes.byteLength > pluginMarketplaceCatalogBytesLimit) throw invalidCatalog()
    const data = catalog.parse(JSON.parse(decoder.decode(bytes)) as unknown)
    const ids = new Set<string>()
    const entries: PluginMarketplaceCatalogEntry[] = []
    for (const row of data.plugins) {
      const value = marketplaceRecord(row)
      if (!value || !isCapabilityPluginId(value.name) || ids.has(value.name)) throw invalidCatalog()
      ids.add(value.name)
      const sourceKind = marketplaceRecord(value.source)?.source
      if (typeof sourceKind === "string" && unsupportedSources.has(sourceKind)) continue
      entries.push(parseEntry(entry.parse(value)))
    }
    return { name: data.name, entries }
  } catch {
    throw invalidCatalog()
  }
}

function parseEntry(data: z.infer<typeof entry>): PluginMarketplaceCatalogEntry {
  const extension = data.pigclaude
  const expected =
    extension?.sha256 === undefined ? null : normalizeMarketplaceChecksum(extension.sha256)
  const source = entrySource(data.source, expected)
  const domains = (extension?.domains ?? []).map((domain) => {
    const value = normalizePluginNetworkDomain(domain)
    if (value === null) throw invalidCatalog()
    return value
  })
  return {
    info: {
      id: data.name,
      name: data.displayName ?? data.name,
      type: extension?.kind ?? "claude-code",
      description: data.description ?? null,
      version: data.version ?? null,
      author: typeof data.author === "string" ? data.author : (data.author?.name ?? null),
      permissions: [...new Set(extension?.permissions ?? [])],
      domains: [...new Set(domains)],
    },
    source,
    expectedSha256: source.kind === "https" ? source.sha256 : expected,
  }
}

function entrySource(value: unknown, expected: string | null): PluginMarketplaceEntrySource {
  if (typeof value === "string")
    return { kind: "relative", path: normalizeMarketplaceRelativePath(value) }
  const fields = marketplaceRecord(value)
  if (fields?.source === "github") {
    const source = normalizePluginMarketplaceSource({
      kind: "github",
      repo: fields.repo,
      commit: fields.sha,
    })
    if (source.kind === "github") return source
  }
  if (fields?.source === "archive") {
    const source = normalizePluginMarketplaceSource({
      kind: "https",
      url: fields.url,
      sha256: fields.sha256 === undefined ? expected : fields.sha256,
    })
    if (source.kind === "https" && (expected === null || expected === source.sha256)) return source
  }
  throw invalidCatalog()
}

function invalidCatalog(): Error {
  return new Error("PLUGIN_MARKETPLACE_CATALOG_INVALID")
}
