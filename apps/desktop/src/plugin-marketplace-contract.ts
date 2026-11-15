// 定义可信窗口可用的市场源、目录条目和安装更新操作，不暴露下载或文件能力。

import type { DesktopPluginInstallDisclosure } from "./capability-plugin-contract"

/** 本机市场源允许固定提交的仓库、带摘要的 HTTPS 归档或开发目录。 */
export type PluginMarketplaceSourceInput =
  | { kind: "github"; repo: string; commit: string }
  | { kind: "https"; url: string; sha256: string }
  | { kind: "directory"; path: string }

/** 已保存市场的本机状态，刷新失败时仍可显示上次成功的目录。 */
export type PluginMarketplaceSourceView = {
  id: string
  kind: PluginMarketplaceSourceInput["kind"] | "official"
  /** GitHub 提交或 HTTPS 归档摘要，本地目录为 null。 */
  pin: string | null
  label: string
  catalogName: string
  enabled: boolean
  refreshedAt: string | null
  entryCount: number
  error: string | null
}

/** 目录公布的产品描述，实际权限仍从下载并验证后的插件包计算。 */
export type PluginMarketplaceEntryInfo = {
  id: string
  name: string
  type: "capability" | "claude-code"
  description: string | null
  version: string | null
  author: string | null
  permissions: string[]
  domains: string[]
}

/** 条目绑定来源 ID，动作由主进程根据已安装记录判定。 */
export type PluginMarketplaceEntryView = PluginMarketplaceEntryInfo & {
  sourceId: string
  action: "install" | "installed" | "update" | "blocked"
  blockedBy?: "expired" | "revoked"
  reviewStatus: "unreviewed" | "reviewed"
}

/** 桌面市场页的缓存投影，未启用来源不出现在 entries 中。 */
export type PluginMarketplaceView = {
  developerMode: boolean
  thirdPartyEnabled: boolean
  thirdPartyError?: string
  sources: PluginMarketplaceSourceView[]
  entries: PluginMarketplaceEntryView[]
}

/** 手动更新需要复核文件或授权变化时进入一次性披露确认。 */
export type PluginMarketplaceUpdateResult =
  | { kind: "unchanged" }
  | { kind: "updated" }
  | {
      kind: "review"
      disclosure: DesktopPluginInstallDisclosure
      additionalPermissions: string[]
      additionalDomains: string[]
      fileHashChanged?: true
    }

/** 可信窗口用本机缓存浏览，用显式操作刷新、安装或手动更新。 */
export type PluginMarketplaceBridge = {
  list(): Promise<PluginMarketplaceView>
  setThirdPartyEnabled(enabled: boolean): Promise<void>
  selectDirectory(): Promise<string | null>
  add(input: PluginMarketplaceSourceInput): Promise<void>
  refresh(sourceId: string, pin?: string): Promise<void>
  setEnabled(sourceId: string, enabled: boolean): Promise<void>
  remove(sourceId: string): Promise<void>
  prepareInstall(sourceId: string, entryId: string): Promise<DesktopPluginInstallDisclosure>
  prepareUpdate(sourceId: string, entryId: string): Promise<PluginMarketplaceUpdateResult>
  subscribe(listener: () => void): () => void
}

/** 市场操作和缓存更新只在可信窗口使用固定频道。 */
export const pluginMarketplaceChannelPrefix = "pigclaude:plugin-marketplace-"

/** 主进程发出无正文的目录或安装状态变化事件。 */
export const pluginMarketplaceChangedChannel = pluginMarketplaceChannelPrefix + "changed"
