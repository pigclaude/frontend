// 将可信桥的插件记录与安装披露转换成列表、详情及对话框需要的只读文本。

import type { PluginSummary } from "@pigclaude/ui-plugin-manager"
import type {
  CapabilityPluginInstallDisclosure,
  CapabilityPluginInstallSource,
  CapabilityPluginPermission,
  InstalledCapabilityPlugin,
} from "../../../../capability-plugin-contract"
import type { TextKey } from "../../locale/text"

const permissions: Record<CapabilityPluginPermission, TextKey> = {
  "workspace-read": "pluginSettings.permissionWorkspace",
  storage: "pluginSettings.permissionStorage",
  secrets: "pluginSettings.permissionSecrets",
  notifications: "pluginSettings.permissionNotifications",
  "composer-insert": "pluginSettings.permissionComposer",
  network: "pluginSettings.permissionNetwork",
}

const sources: Record<CapabilityPluginInstallSource["kind"], TextKey> = {
  archive: "pluginSettings.sourceArchive",
  directory: "pluginSettings.sourceDirectory",
}

/** 安装前公开展示的事实；之后可接入 Claude Code 插件的组件与 Skill 元数据。 */
export type PluginDisclosureFacts = {
  name: string
  version: string
  typeLabel: string
  permissions: readonly string[]
  domains: readonly string[]
  tools: ReadonlyArray<{ name: string; description: string }>
  ignoredComponents: readonly string[]
  skillExecution: readonly string[]
}

/** 能力插件披露只使用经过宿主校验的清单，它没有 Claude Code 组件或 Skill。 */
export function capabilityPluginDisclosure(
  { manifest }: CapabilityPluginInstallDisclosure,
  t: (key: TextKey) => string,
): PluginDisclosureFacts {
  return {
    name: manifest.name,
    version: manifest.version,
    typeLabel: t("pluginSettings.capability"),
    permissions: manifest.permissions.map((permission) => t(permissions[permission])),
    domains: manifest.networkDomains,
    tools: manifest.tools,
    ignoredComponents: [],
    skillExecution: [],
  }
}

/** 适配 Pigcode 的通用插件卡片数据，详情只显示本机来源类型。 */
export function installedPluginSummary(
  plugin: InstalledCapabilityPlugin,
  t: (key: TextKey) => string,
  hasSettings: boolean,
): PluginSummary {
  const { manifest } = plugin
  return {
    id: manifest.id,
    name: manifest.id,
    displayName: manifest.name,
    description: manifest.description ?? null,
    version: manifest.version,
    kind: "capability",
    enabled: plugin.enabled,
    apiVersion: manifest.apiVersion,
    permissions: manifest.permissions.map((permission) => t(permissions[permission])),
    provides: manifest.tools.map((tool) => tool.name),
    contributes: {},
    conflict: null,
    error: plugin.compatible ? null : t("pluginSettings.incompatible"),
    originLabel: t(sources[plugin.sourceKind]),
    ...(hasSettings ? { settingsPage: manifest.id } : {}),
  }
}

const errors = new Map<string, TextKey>([
  ["MEMBERSHIP_REQUIRED", "pluginSettings.membership"],
  ["PLUGIN_DEVELOPER_MODE_REQUIRED", "pluginSettings.directoryDisabled"],
  ["PLUGIN_MANAGER_UNAVAILABLE", "pluginSettings.unavailable"],
  ["PLUGIN_CONFIRMATION_INVALID", "pluginSettings.confirmationExpired"],
  ["PLUGIN_ALREADY_INSTALLED", "pluginSettings.alreadyInstalled"],
  ["PLUGIN_NOT_INSTALLED", "pluginSettings.noLongerInstalled"],
  ["PLUGIN_VERSION_INCOMPATIBLE", "pluginSettings.incompatible"],
  ["PLUGIN_API_UNSUPPORTED", "pluginSettings.incompatible"],
  ["PLUGIN_MANIFEST_INVALID", "pluginSettings.invalidManifest"],
  ["PLUGIN_DOMAIN_INVALID", "pluginSettings.invalidDomain"],
  ["PLUGIN_SOURCE_INVALID", "pluginSettings.invalidSource"],
  ["PLUGIN_BUNDLE_INVALID", "pluginSettings.invalidSource"],
  ["PLUGIN_BUNDLE_UNSAFE", "pluginSettings.invalidSource"],
  ["PLUGIN_ARCHIVE_INVALID", "pluginSettings.invalidSource"],
  ["PLUGIN_ARCHIVE_UNSAFE", "pluginSettings.invalidSource"],
  ["PLUGIN_BUNDLE_TOO_LARGE", "pluginSettings.sourceTooLarge"],
  ["PLUGIN_ARCHIVE_TOO_LARGE", "pluginSettings.sourceTooLarge"],
  ["PLUGIN_ARCHIVE_SHA256_INVALID", "pluginSettings.invalidDigest"],
  ["PLUGIN_ARCHIVE_SHA256_MISMATCH", "pluginSettings.digestMismatch"],
])

/** 只展示固定错误码的翻译，覆盖 Electron 包装后的异常。 */
export function pluginSettingsError(
  error: unknown,
  fallback: TextKey = "pluginSettings.failed",
): TextKey {
  const code = error instanceof Error ? error.message.match(/\b([A-Z][A-Z0-9_]+)$/)?.[1] : undefined
  return (code ? errors.get(code) : undefined) ?? fallback
}
