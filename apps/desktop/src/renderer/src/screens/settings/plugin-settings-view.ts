// 将可信桥的插件记录与安装披露转换成列表、详情及对话框需要的只读文本。

import type { PluginSummary } from "@pigclaude/ui-plugin-manager"
import type {
  CapabilityPluginInstallSource,
  CapabilityPluginPermission,
  ClaudeCodePluginManifest,
  DesktopPluginInstallDisclosure,
  InstalledDesktopPlugin,
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
const permissionLabels = new Map<string, TextKey>(Object.entries(permissions))

/** 将主进程认可的能力权限翻成可读名称，目录中的其他声明照原文显示。 */
export function pluginPermissionText(permission: string, t: (key: TextKey) => string): string {
  const label = permissionLabels.get(permission)
  return label ? t(label) : permission
}

const sources: Record<CapabilityPluginInstallSource["kind"], TextKey> = {
  archive: "pluginSettings.sourceArchive",
  directory: "pluginSettings.sourceDirectory",
}

/** 两类安装披露共有名称和版本；各自的事实只取经过宿主校验的数据。 */
export type PluginDisclosureFacts = {
  name: string
  version: string
  typeLabel: string
} & (
  | {
      type: "capability"
      permissions: readonly string[]
      domains: readonly string[]
      tools: ReadonlyArray<{ name: string; description: string }>
    }
  | { type: "claude-code"; manifest: ClaudeCodePluginManifest }
)

/** 从待确认的安装数据提取与插件类型相符的可见事实。 */
export function pluginInstallDisclosure(
  prepared: DesktopPluginInstallDisclosure,
  t: (key: TextKey) => string,
): PluginDisclosureFacts {
  const { name, version } = prepared.manifest
  if (prepared.type === "claude-code")
    return {
      type: prepared.type,
      name,
      version,
      typeLabel: t("pluginSettings.claudeCode"),
      manifest: prepared.manifest,
    }
  return {
    type: prepared.type,
    name,
    version,
    typeLabel: t("pluginSettings.capability"),
    permissions: prepared.manifest.permissions.map((permission) => t(permissions[permission])),
    domains: prepared.manifest.networkDomains,
    tools: prepared.manifest.tools,
  }
}

/** 适配 Pigcode 的通用插件卡片数据，详情只显示本机来源类型。 */
export function installedPluginSummary(
  plugin: InstalledDesktopPlugin,
  t: (key: TextKey) => string,
  hasSettings: boolean,
): PluginSummary {
  const { manifest } = plugin
  const capability = plugin.type === "capability" ? plugin.manifest : null
  return {
    id: manifest.id,
    name: manifest.id,
    displayName: manifest.name,
    description: manifest.description ?? null,
    version: manifest.version,
    kind: capability ? "capability" : "agent",
    enabled: plugin.enabled,
    apiVersion: capability?.apiVersion ?? 0,
    permissions: capability?.permissions.map((permission) => t(permissions[permission])) ?? [],
    provides: capability?.tools.map((tool) => tool.name) ?? [],
    contributes: {},
    conflict: null,
    error: plugin.compatible ? null : t("pluginSettings.incompatible"),
    originLabel: t(sources[plugin.sourceKind]),
    ...(capability && hasSettings ? { settingsPage: manifest.id } : {}),
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
