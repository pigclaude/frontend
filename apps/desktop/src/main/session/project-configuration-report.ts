// 把读取的项目配置变成脱敏报告，只披露信任确认所需的可执行项与名称。
import JSON5 from "json5"
import { readClaudeMarkdown, skillExecutionOf } from "./claude-markdown"
import {
  pigclaudeProjectCommandNames,
  type ProjectConfigurationReport,
  type ProjectTrustStatus,
} from "../../project-configuration-contract"
import type { ProjectCommandSource } from "./project-command-catalog"

const credentialsFields = [
  "apiKeyHelper",
  "proxyAuthHelper",
  "awsAuthRefresh",
  "awsCredentialExport",
  "gcpAuthRefresh",
  "otelHeadersHelper",
]

/** 文件文本只在主进程传递；null 表示没有成功读取现存文件。 */
export type ReportFile = { path: string; text: string | null }

/** 报告的原始只读输入。正文和未筛选的设置绝不会返回给调用界面。 */
export type ProjectReportInput = {
  workspace: string
  trust: ProjectTrustStatus
  instructions: string[]
  commands: readonly ProjectCommandSource[]
  agentCount: number
  settings: readonly ReportFile[]
  mcp: readonly ReportFile[]
  skills: ReadonlyArray<ReportFile & { name: string }>
}

/** 从配置快照提取命令和名称，避免接口意外带出环境值或第三方认证材料。 */
export function describeProjectConfiguration(
  input: ProjectReportInput,
): ProjectConfigurationReport {
  const unreadable = new Set<string>()
  const settings = parseFiles(input.settings, unreadable)
  const mcpFiles = parseFiles(input.mcp, unreadable)
  const servers = mcpFiles.flatMap((file) => Object.entries(fields(file.mcpServers)))
  const env = [
    ...settings.map((item) => fields(item.env)),
    ...servers.map(([, server]) => fields(fields(server).env)),
  ]
  const sensitive = [
    ...new Set([
      ...env.flatMap((item) => Object.values(item)),
      ...servers.flatMap(([, item]) => Object.values(fields(fields(item).headers))),
    ]),
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .sort((a, b) => b.length - a.length)
  const commandText = (value: unknown) =>
    typeof value === "string"
      ? sensitive.reduce((safe, literal) => safe.split(literal).join("[已隐藏]"), value)
      : null
  const hooks = settings.flatMap((item) =>
    Object.entries(fields(item.hooks)).flatMap(([event, groups]) =>
      list(groups).flatMap((group) =>
        list(fields(group).hooks).map((entry) => {
          const hook = fields(entry)
          return {
            event,
            kind: typeof hook.type === "string" ? hook.type : "unknown",
            command: commandText(hook.command),
          }
        }),
      ),
    ),
  )
  const credentialScripts = settings.flatMap((item) =>
    credentialsFields.flatMap((name) => {
      const command = commandText(item[name])
      return command ? [{ name, command }] : []
    }),
  )
  const skillExecution = input.skills.flatMap(({ name, path, text }) => {
    if (text === null) {
      unreadable.add(path)
      return []
    }
    try {
      const execution = skillExecutionOf(readClaudeMarkdown(text))
      return Object.values(execution).some(Boolean) ? [{ name, ...execution }] : []
    } catch {
      unreadable.add(path)
      return []
    }
  })
  const reserved = new Set<string>(Object.values(pigclaudeProjectCommandNames))
  return {
    workspace: input.workspace,
    trust: input.trust,
    hasProjectSettings: input.settings.length > 0 || input.mcp.length > 0,
    instructions: input.instructions,
    counts: {
      commands: input.commands.filter((item) => item.kind === "command").length,
      skills: input.commands.filter((item) => item.kind === "skill").length,
      agents: input.agentCount,
    },
    hooks,
    environment: [...new Set(env.flatMap((item) => Object.keys(item)))].sort(),
    servers: servers.map(([name, value]) => ({
      name,
      command: commandText(fields(value).command),
    })),
    credentialScripts,
    skillExecution,
    shadowedCommands: [...new Set(input.commands.map(({ name }) => name))].filter((name) =>
      reserved.has(name.toLowerCase()),
    ),
    unreadable: [...unreadable],
  }
}

function parseFiles(
  files: readonly ReportFile[],
  unreadable: Set<string>,
): Record<string, unknown>[] {
  return files.flatMap(({ path, text }) => {
    try {
      const config: unknown = text === null ? null : JSON5.parse(text)
      if (config && typeof config === "object" && !Array.isArray(config)) return [fields(config)]
    } catch {
      // 报告只列无法读取的文件名，不转发解析器错误或文件内容。
    }
    unreadable.add(path)
    return []
  })
}

function fields(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}
