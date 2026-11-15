// 描述受信主进程交给一次会话的能力插件快照，类型不依赖安装与文件读取实现。

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
