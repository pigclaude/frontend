// 为已启动的会话保留 SDK 最新命令快照，草稿的命令只读本机项目目录。

import type { AgentCommand } from "@pigclaude/ui-contracts"
import { claudeCommands, draftBuiltinCommands } from "./claude-commands"
import { scanProjectCommands } from "./project-command-catalog"
import type { SessionHost } from "./session-host"

const catalogs = new WeakMap<SessionHost, Map<string, readonly AgentCommand[]>>()

/** 在会话服务发布事件前装配缓存；命令变更整表替换，CLI 退出就清除会话的快照。 */
export function trackSessionCommandCatalogs(host: SessionHost): void {
  const values = new Map<string, readonly AgentCommand[]>()
  catalogs.set(host, values)
  host.subscribe(({ sessionId, event }) => {
    if (sessionId === null) return
    if (event.type === "commands-changed") values.set(sessionId, event.commands)
    if (event.type === "ended") values.delete(sessionId)
  })
}

/** 返回实际会话的命令；没有已加载的 SDK 快照时按项目范围枚举草稿占位命令。 */
export async function readCommandCatalog(
  host: SessionHost | null,
  workspace: string,
  sessionId?: string,
): Promise<readonly AgentCommand[]> {
  const current = host !== null && sessionId ? catalogs.get(host)?.get(sessionId) : undefined
  if (current !== undefined) return current
  const project = await scanProjectCommands(workspace)
  return claudeCommands([...draftBuiltinCommands(), ...project.map(({ name }) => ({ name }))])
}
