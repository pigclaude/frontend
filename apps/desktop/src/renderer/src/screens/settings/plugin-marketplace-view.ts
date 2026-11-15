// 将市场源的缓存状态和固定错误码转成设置页可显示的文字。

import { formatRelativeTime, type Locale } from "@pigclaude/ui-primitives"
import type {
  PluginMarketplaceSourceInput,
  PluginMarketplaceSourceView,
} from "../../../../plugin-marketplace-contract"
import { fill, type TextKey } from "../../locale/text"
import { pluginPermissionText, pluginSettingsError } from "./plugin-settings-view"

/** 来源选择器和来源行共用的标签。 */
export const marketplaceSourceLabels: Record<PluginMarketplaceSourceInput["kind"], TextKey> = {
  github: "pluginMarketplace.github",
  https: "pluginMarketplace.https",
  directory: "pluginMarketplace.directory",
}

/** 固定提交和 SHA-256 在提交前规范为对应长度的小写十六进制。 */
export function marketplaceSourcePin(kind: "github" | "https", value: string): string | null {
  const pin = value.trim().toLowerCase()
  const valid = kind === "github" ? /^[0-9a-f]{40}$/ : /^[0-9a-f]{64}$/
  return valid.test(pin) ? pin : null
}

/** 刷新失败时沿用主进程返回的最后成功时间和目录条目数。 */
export function marketplaceSourceMeta(
  source: PluginMarketplaceSourceView,
  locale: Locale,
  t: (key: TextKey) => string,
): string {
  const count = fill(t("pluginMarketplace.cachedCount"), { count: source.entryCount })
  const refreshed = source.refreshedAt
    ? fill(t("pluginMarketplace.refreshed"), {
        time: formatRelativeTime(source.refreshedAt, locale),
      })
    : t("pluginMarketplace.neverRefreshed")
  return `${count} · ${refreshed}`
}

const errors = new Map<string, TextKey>([
  ["MEMBERSHIP_REQUIRED", "pluginMarketplace.membership"],
  ["PLUGIN_MARKETPLACE_UNAVAILABLE", "pluginMarketplace.loadFailed"],
  ["PLUGIN_MARKETPLACE_THIRD_PARTY_DISABLED", "pluginMarketplace.thirdPartyOff"],
  ["PLUGIN_MARKETPLACE_REFRESH_FAILED", "pluginMarketplace.refreshFailed"],
  ["PLUGIN_MARKETPLACE_SOURCE_DISABLED", "pluginMarketplace.sourceDisabled"],
  ["PLUGIN_MARKETPLACE_SOURCE_NOT_FOUND", "pluginMarketplace.sourceDisabled"],
  ["PLUGIN_MARKETPLACE_SOURCE_EXISTS", "pluginMarketplace.sourceExists"],
  ["PLUGIN_MARKETPLACE_SOURCE_INVALID", "pluginMarketplace.sourceInvalid"],
  ["PLUGIN_MARKETPLACE_SOURCE_CHANGED", "pluginMarketplace.sourceChanged"],
  ["PLUGIN_MARKETPLACE_SOURCE_UNAVAILABLE", "pluginMarketplace.sourceUnavailable"],
  ["PLUGIN_MARKETPLACE_ENTRY_NOT_FOUND", "pluginMarketplace.entryUnavailable"],
  ["PLUGIN_MARKETPLACE_ENTRY_UNAVAILABLE", "pluginMarketplace.entryUnavailable"],
  ["PLUGIN_MARKETPLACE_PACKAGE_MISMATCH", "pluginMarketplace.packageMismatch"],
  ["PLUGIN_MARKETPLACE_CATALOG_INVALID", "pluginMarketplace.sourceInvalid"],
  ["PLUGIN_MARKETPLACE_INSTALLATION_MISMATCH", "pluginMarketplace.sourceInvalid"],
])

/** 将主进程和缓存中的固定错误码本地化，无匹配时使用指定的可重试提示。 */
export function marketplaceErrorKey(
  error: unknown,
  fallback: TextKey = "pluginMarketplace.failed",
): TextKey {
  const message = error instanceof Error ? error.message : error
  const code = typeof message === "string" ? message.match(/\b([A-Z][A-Z0-9_]+)$/)?.[1] : undefined
  return code ? (errors.get(code) ?? pluginSettingsError(new Error(code), fallback)) : fallback
}

const skillPermissions = new Map<string, TextKey>([
  ["skill-inline", "pluginSettings.skillInline"],
  ["skill-hooks", "pluginSettings.skillHooks"],
  ["skill-allowed-tools", "pluginSettings.skillAllowedTools"],
])

/** 更新新增的 Skill 执行项标明行为和完整命令名。 */
export function marketplacePermissionChangeText(
  permission: string,
  t: (key: TextKey) => string,
): string {
  const separator = permission.indexOf(":")
  const label = separator >= 0 ? skillPermissions.get(permission.slice(0, separator)) : undefined
  return label
    ? `${t(label)} · ${permission.slice(separator + 1)}`
    : pluginPermissionText(permission, t)
}
