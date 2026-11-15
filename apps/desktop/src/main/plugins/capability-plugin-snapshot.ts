// 维护沙箱启动的插件快照和可信窗口可读的安装状态。

import type {
  InstalledCapabilityPlugin,
  InstalledDesktopPlugin,
} from "../../capability-plugin-contract"
import { isCapabilityPluginCompatible } from "./capability-plugin-manifest"
import type { CapabilityPluginRecord, DesktopPluginRecord } from "./capability-plugin-records"
import type {
  CapabilityPluginManifest,
  CapabilityPluginToolApproval,
} from "../../capability-plugin-contract"

/** 会话启动时获取的快照，仅供主进程接入插件沙箱。 */
export type CapabilityPluginSnapshot = {
  manifest: CapabilityPluginManifest
  revision: string
  modules: Readonly<Record<string, string>>
  approvedDomains: readonly string[]
  toolApproval: CapabilityPluginToolApproval
  dataDirectory: string
  secretsFile: string
}

/** Claude Code 插件始终可装配；能力插件受清单中的应用版本范围约束。 */
export function isDesktopPluginCompatible(
  record: DesktopPluginRecord,
  appVersion: string,
): boolean {
  return record.type === "claude-code" || isCapabilityPluginCompatible(record.manifest, appVersion)
}

/** 将本机记录投影为可信窗口的安装状态，内存中的吊销也即时可见。 */
export function describeInstalledPlugin(
  record: CapabilityPluginRecord,
  appVersion: string,
  revocationReason: string | undefined,
): InstalledCapabilityPlugin
export function describeInstalledPlugin(
  record: DesktopPluginRecord,
  appVersion: string,
  revocationReason: string | undefined,
): InstalledDesktopPlugin
export function describeInstalledPlugin(
  record: DesktopPluginRecord,
  appVersion: string,
  revocationReason: string | undefined,
): InstalledDesktopPlugin {
  const { revision, installedAt, sourceKind, sha256, enabled } = record
  const common = {
    revision,
    installedAt,
    sourceKind,
    sha256,
    enabled: enabled && revocationReason === undefined,
    compatible: isDesktopPluginCompatible(record, appVersion),
    ...(revocationReason === undefined ? {} : { revocationReason }),
  }
  return record.type === "claude-code"
    ? { ...common, type: record.type, manifest: record.manifest }
    : {
        ...common,
        type: record.type,
        manifest: record.manifest,
        approvedDomains: record.approvedDomains,
        toolApproval: record.toolApproval,
      }
}
