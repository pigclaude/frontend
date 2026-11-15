// 定义主进程装配能力插件 MCP 工具所需的安装快照、沙箱与出口端口。

import type { CapabilityPluginManager } from "./capability-plugin-manager"
import type { PluginNetworkAccess, PluginSandboxNetwork } from "./plugin-sandbox-contract"
import type { PluginSandboxHost } from "./plugin-sandbox-host"

/** 会话启动时取已启用工具，调用时核验安装版本，网络能力只在主进程内传递。 */
export type CapabilityPluginToolDependencies = {
  manager: Pick<CapabilityPluginManager, "snapshotEnabled" | "canInvoke">
  sandbox: Pick<PluginSandboxHost, "invoke">
  pluginNetwork: (sessionId: string, access: PluginNetworkAccess) => Promise<PluginSandboxNetwork>
}
