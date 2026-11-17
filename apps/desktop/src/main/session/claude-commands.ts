// 将 Claude Code 的命令元数据变成输入框可以显示和插入的命令，过滤本机专用命令和产品保留项。

import type { AgentCommand } from "@pigclaude/ui-contracts"
import type { SlashCommand } from "@anthropic-ai/claude-agent-sdk"

const builtins = ["compact", "context", "init"] as const
const allowedBuiltinNames = new Set<string>(builtins)
const reservedNames = new Set([
  "add-dir",
  "config",
  "exit",
  "feedback",
  "login",
  "logout",
  "mcp",
  "model",
  "new",
  "panel",
  "plugin",
  "statusline",
  "terminal-setup",
])

/** 只展示输入框支持的原生 skill 名，保留 CLI 内置命令的优先级。 */
export function isClaudeSkillName(name: string): boolean {
  return (
    /^[a-zA-Z0-9][\w.:-]{0,127}$/.test(name) &&
    !/^\d[\d_]*(?:[kKmMbBtT]|[eE]\d+)?$/.test(name) &&
    !allowedBuiltinNames.has(name) &&
    !reservedNames.has(name)
  )
}

/** 映射命令名与插入文字，保留 CLI 同名时实际调用的条目。 */
export function claudeCommands(
  candidates: readonly (Pick<SlashCommand, "name" | "builtin"> &
    Partial<Pick<SlashCommand, "description" | "argumentHint">>)[],
  terminal: readonly string[] = [],
): AgentCommand[] {
  const byName = new Map<string, (typeof candidates)[number]>()
  const excluded = new Set([...reservedNames, ...terminal.map((name) => name.replace(/^\//, ""))])
  for (const command of candidates) {
    if (!/^[\p{L}\p{N}][\p{L}\p{N}_.:-]{0,127}$/u.test(command.name)) continue
    if (excluded.has(command.name)) continue
    if (!byName.has(command.name) || command.builtin) byName.set(command.name, command)
  }
  return [...byName.values()]
    .filter((command) => !command.builtin || allowedBuiltinNames.has(command.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((command) => ({
      name: command.name,
      text: `/${command.name}`,
      kind: command.builtin ? "builtin" : "skill",
      ...(command.description ? { description: command.description.slice(0, 300) } : {}),
      ...(command.argumentHint ? { argumentHint: command.argumentHint.slice(0, 150) } : {}),
    }))
}

/** 草稿未启动会话前可展示的内置命令，实际会话启动后以 SDK 为准。 */
export function draftBuiltinCommands(): Array<Pick<SlashCommand, "name" | "builtin">> {
  return builtins.map((name) => ({ name, builtin: true }))
}
