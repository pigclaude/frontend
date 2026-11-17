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
const unsupportedSources = new Set(["npm", "command", "git"])
const githubUrl = /^https:\/\/github\.com\/([a-z0-9_.-]+\/[a-z0-9_.-]+)$/i
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
      if (!value) throw invalidCatalog()
      const source = marketplaceRecord(value.source)
      const sourceKind = source?.source
      const external = sourceKind === "url" || sourceKind === "git-subdir"
      const pinned = external ? githubArchiveSource(source) : undefined
      if (external && (!pinned || !isCapabilityPluginId(value.name))) continue
      if (!isCapabilityPluginId(value.name) || ids.has(value.name)) throw invalidCatalog()
      ids.add(value.name)
      if (typeof sourceKind === "string" && unsupportedSources.has(sourceKind)) continue
      entries.push(parseEntry(entry.parse(value), pinned))
    }
    return { name: data.name, entries }
  } catch {
    throw invalidCatalog()
  }
}

function parseEntry(
  data: z.infer<typeof entry>,
  pinned: PluginMarketplaceEntrySource | undefined,
): PluginMarketplaceCatalogEntry {
  const extension = data.pigclaude
  const expected =
    extension?.sha256 === undefined ? null : normalizeMarketplaceChecksum(extension.sha256)
  const source = pinned ?? entrySource(data.source, expected)
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

function githubArchiveSource(
  fields: Record<string, unknown> | undefined,
): PluginMarketplaceEntrySource | undefined {
  if (!fields || typeof fields.url !== "string") return undefined
  const repo = githubUrl.exec(fields.url)?.[1]?.replace(/\.git$/i, "")
  if (!repo) return undefined
  try {
    const pinned = normalizePluginMarketplaceSource({ kind: "github", repo, commit: fields.sha })
    if (pinned.kind !== "github") return undefined
    if (fields.source === "url") return pinned
    if (typeof fields.path !== "string" || !fields.path) return undefined
    const path = normalizeMarketplaceRelativePath(
      fields.path.startsWith("./") ? fields.path : "./" + fields.path,
    )
    return path === "./" ? undefined : { ...pinned, kind: "github-subdir", path }
  } catch {
    return undefined
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
