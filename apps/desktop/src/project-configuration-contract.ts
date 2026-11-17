// 定义项目配置报告与本机信任确认，主进程只通过这里的脱敏字段向界面披露配置。

/** 会遮住同名项目命令的 PigClaude 应用命令。 */
export const pigclaudeProjectCommandNames = { newSession: "new", workbench: "panel" } as const

/** 项目信任由真实路径区分；个人配置路径没有可修改的项目状态。 */
export type ProjectTrustStatus = "trusted" | "untrusted" | "blocked"

/** 界面使用的配置报告，不带环境变量值、MCP 参数和请求头。 */
export type ProjectConfigurationReport = {
  workspace: string
  trust: ProjectTrustStatus
  /** 当前路径下是否发现会受启用状态控制的项目设置或 MCP 配置。 */
  hasProjectSettings: boolean
  instructions: string[]
  counts: { commands: number; skills: number; agents: number }
  hooks: Array<{ event: string; kind: string; command: string | null }>
  environment: string[]
  servers: Array<{ name: string; command: string | null }>
  credentialScripts: Array<{ name: string; command: string }>
  skillExecution: Array<{ name: string; inline: boolean; hooks: boolean; allowedTools: boolean }>
  shadowedCommands: string[]
  unreadable: string[]
}

/** 主进程生成的一次性确认标识，与当前配置报告和变更方向绑定。 */
export type ProjectTrustConfirmation = {
  id: string
  trusted: boolean
  report: ProjectConfigurationReport
}

/** 项目卡片的独立 IPC 面。只有完成已准备的确认才能记录信任变更。 */
export type ProjectConfigurationBridge = {
  report(workspace: string): Promise<ProjectConfigurationReport>
  prepare(workspace: string, trusted: boolean): Promise<ProjectTrustConfirmation>
  confirm(id: string): Promise<ProjectConfigurationReport>
}
