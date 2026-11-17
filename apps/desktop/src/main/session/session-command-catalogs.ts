// 为活跃会话保留 SDK 最新命令快照，用项目和已启用插件提供草稿占位命令。

import type { AgentCommand } from "@pigclaude/ui-contracts"
import type { ClaudeCodePluginSessionSource } from "./claude-code-plugin-session-source"
import { claudeCommands, draftBuiltinCommands } from "./claude-commands"
import { claudeSkillChoice } from "./claude-skill-invocations"
import { scanProjectCommandCatalog } from "./project-command-catalog"
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

/** 活跃命令取 SDK；项目 Skill 选项使用同一工作目录的本地元数据。 */
export async function readCommandCatalog(
  host: SessionHost | null,
  workspace: string,
  sessionId?: string,
): Promise<readonly AgentCommand[]> {
  const catalog = host === null ? undefined : catalogs.get(host)
  const current = sessionId === undefined ? undefined : catalog?.live.get(sessionId)
  const [project, pluginNames, personal] = await Promise.all([
    scanProjectCommandCatalog(workspace).catch((error: unknown) => {
      if (current === undefined) throw error
      return { commands: [], skills: [] }
    }),
    sessionId === undefined ? catalog?.plugins?.commands().catch(() => []) : undefined,
    sessionId === undefined ? catalog?.plugins?.personalSkills?.().catch(() => []) : undefined,
  ])
  const commands =
    current ??
    claudeCommands([
      ...draftBuiltinCommands(),
      ...project.commands.map(({ name }) => ({ name })),
      ...(pluginNames ?? []).map((name) => ({ name })),
    ])
  const selectable = new Set(
    commands
      .filter(({ kind, text }) => kind === "skill" && text.startsWith("/"))
      .map(({ name }) => name),
  )
  const taken = new Set([...project.commands.map(({ name }) => name), ...(pluginNames ?? [])])
  const appPluginNames = new Set((pluginNames ?? []).map((name) => name.split(":", 1)[0]))
  return [
    ...commands,
    ...project.skills
      .filter(({ name }) => selectable.has(name))
      .map((skill) => claudeSkillChoice(skill, "project")),
    ...(personal ?? [])
      .filter(
        ({ name, plugin }) => !taken.has(name) && (!plugin || !appPluginNames.has(plugin.name)),
      )
      .map((skill) => claudeSkillChoice(skill, "user")),
  ]
}
