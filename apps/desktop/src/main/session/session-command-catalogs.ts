// 为活跃会话保留 SDK 最新命令快照，用项目和已启用插件提供草稿占位命令。

import type { AgentCommand } from "@pigclaude/ui-contracts"
import type { ClaudeCodePluginSessionSource } from "./claude-code-plugin-session-source"
import { claudeCommands, draftBuiltinCommands } from "./claude-commands"
import { scanProjectCommands } from "./project-command-catalog"
import type { SessionHost } from "./session-host"

type Catalog = {
  live: Map<string, readonly AgentCommand[]>
  plugins: ClaudeCodePluginSessionSource | undefined
}

const catalogs = new WeakMap<SessionHost, Catalog>()

/** 在会话服务发布事件前装配缓存；命令变更整表替换，CLI 退出就清除会话的快照。 */
export function trackSessionCommandCatalogs(
  host: SessionHost,
  plugins?: ClaudeCodePluginSessionSource,
): void {
  const live = new Map<string, readonly AgentCommand[]>()
  catalogs.set(host, { live, plugins })
  host.subscribe(({ sessionId, event }) => {
    if (sessionId === null) return
    if (event.type === "commands-changed") live.set(sessionId, event.commands)
    if (event.type === "ended") live.delete(sessionId)
  })
}

/** 活跃命令取实际 SDK；只有草稿的项目占位列表才加当前已启用插件的声明。 */
export async function readCommandCatalog(
  host: SessionHost | null,
  workspace: string,
  sessionId?: string,
): Promise<readonly AgentCommand[]> {
  const catalog = host === null ? undefined : catalogs.get(host)
  const current = sessionId === undefined ? undefined : catalog?.live.get(sessionId)
  if (current !== undefined) return current

  const [project, pluginNames] = await Promise.all([
    scanProjectCommands(workspace),
    sessionId === undefined ? catalog?.plugins?.commands().catch(() => []) : undefined,
  ])
  return claudeCommands([
    ...draftBuiltinCommands(),
    ...project.map(({ name }) => ({ name })),
    ...(pluginNames ?? []).map((name) => ({ name })),
  ])
}
