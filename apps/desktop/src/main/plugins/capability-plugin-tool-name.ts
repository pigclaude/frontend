// 为能力插件的进程内 MCP 服务和工具生成会话之间一致的名称。

import { createHash } from "node:crypto"

/** 使用只含 MCP 名称安全字符的插件标识，分别保留点、短横线和下划线的区别。 */
export function capabilityPluginServerName(pluginId: string): string {
  const id = createHash("sha256").update(pluginId).digest("hex").slice(0, 24)
  return `pigclaude_plugin_${id}`
}

/** 返回 SDK 给已登记能力插件工具使用的完整名称。 */
export function capabilityPluginToolName(pluginId: string, toolName: string): string {
  return `mcp__${capabilityPluginServerName(pluginId)}__${toolName}`
}
