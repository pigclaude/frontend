// 保存主进程读取的市场条目来源与下载证据，可信窗口只看到条目的展示字段。

import type {
  PluginMarketplaceEntryInfo,
  PluginMarketplaceSourceInput,
} from "../../plugin-marketplace-contract"

/** 条目来自当前目录中相对路径，或另一个可校验的固定来源。 */
export type PluginMarketplaceEntrySource =
  { kind: "relative"; path: string } | Exclude<PluginMarketplaceSourceInput, { kind: "directory" }>

/** 规范化的目录条目；下载摘要保留在主进程。 */
export type PluginMarketplaceCatalogEntry = {
  info: PluginMarketplaceEntryInfo
  source: PluginMarketplaceEntrySource
  expectedSha256: string | null
}

/** 缓存时保留目录名和可重新定位的批准来源。 */
export type PluginMarketplaceCatalog = {
  name: string
  entries: PluginMarketplaceCatalogEntry[]
}

/** 读包产出供安装器验证的文件正文与实际可核验的来源。 */
export type PluginMarketplaceLoadedEntry = {
  files: ReadonlyMap<string, Buffer>
  digest: string
  archiveSha256: string | null
  repo: string | null
  commit: string | null
}

/** 已装插件的市场归属及内容摘要，用于定位手动更新和核查下载来源。 */
export type PluginMarketplaceProvenance = Omit<PluginMarketplaceLoadedEntry, "files"> & {
  sourceId: string
  entryId: string
}
