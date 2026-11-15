// 定义安装确认、插件运行时和声明式设置共用的能力插件数据，无代码或密钥内容进入主窗口桥。

import type { PluginSandboxJson } from "./main/plugins/plugin-sandbox-contract"

/** 能力插件包根目录中的清单文件。 */
export const capabilityPluginManifestFile = "pigclaude-plugin.json"

/** 能力插件 API 只接受当前宿主版本。 */
export const capabilityPluginApiVersion = 1

/** 插件包允许申请的白名单能力。 */
export type CapabilityPluginPermission =
  "workspace-read" | "storage" | "secrets" | "notifications" | "composer-insert" | "network"

/** 工具由宿主登记，输入是对象形状的 JSON Schema。 */
export type CapabilityPluginTool = {
  name: string
  description: string
  inputSchema: Readonly<Record<string, PluginSandboxJson>>
}

/** 同一插件在新会话里的工具询问规则；缺少偏好时始终逐次询问。 */
export type CapabilityPluginToolApproval = "always_ask" | "follow_session"

/** 权限卡只显示宿主登记的插件与工具名称。 */
export type CapabilityPluginPermissionSource = { id: string; name: string; toolName: string }

type Setting = {
  key: string
  label: string
  description?: string | undefined
  required?: boolean | undefined
}

/** 声明式设置字段；密钥没有明文默认值。 */
export type CapabilityPluginSetting =
  | (Setting & { type: "text"; defaultValue?: string | undefined })
  | (Setting & { type: "secret" })
  | (Setting & { type: "boolean"; defaultValue?: boolean | undefined })
  | (Setting & { type: "number"; defaultValue?: number | undefined })
  | (Setting & {
      type: "select"
      options: Array<{ label: string; value: string }>
      defaultValue?: string | undefined
    })

/** 用户主动触发的命令，可声明命令面板标题和斜杠名称。 */
export type CapabilityPluginCommand = {
  id: string
  title: string
  description?: string | undefined
  slash?: string | undefined
}

/** 声明纯文本模板，{{result}} 引用整个结果，{{field.path}} 引用 JSON 标量字段。 */
export type CapabilityPluginToolResultTemplate = { tool: string; template: string }

/** 经过宿主校验的清单。省略的贡献项会规范成空列表。 */
export type CapabilityPluginManifest = {
  apiVersion: typeof capabilityPluginApiVersion
  id: string
  name: string
  version: string
  pigclaudeVersion: string
  entry: string
  description?: string | undefined
  tools: CapabilityPluginTool[]
  permissions: CapabilityPluginPermission[]
  networkDomains: string[]
  settings: CapabilityPluginSetting[]
  commands: CapabilityPluginCommand[]
  toolResultTemplates: CapabilityPluginToolResultTemplate[]
}

/** 只支持开发目录和带摘要的现成归档两类来源。 */
export type CapabilityPluginInstallSource =
  { kind: "directory"; path: string } | { kind: "archive"; path: string; sha256: string }

/** 主进程交给可信窗口的披露，确认 id 只对应这一份包内容。 */
export type CapabilityPluginInstallDisclosure = {
  type: "capability"
  confirmationId: string
  manifest: CapabilityPluginManifest
  sourceKind: CapabilityPluginInstallSource["kind"]
  sha256: string | null
}

/** 本机插件列表的记录。启用变化从新会话起生效，兼容性随当前 PigClaude 版本计算。 */
export type InstalledCapabilityPlugin = {
  type: "capability"
  manifest: CapabilityPluginManifest
  revision: string
  installedAt: string
  sourceKind: CapabilityPluginInstallSource["kind"]
  sha256: string | null
  approvedDomains: string[]
  toolApproval: CapabilityPluginToolApproval
  enabled: boolean
  compatible: boolean
}

/** 安装时披露但不加载的 Claude Code 插件组件类别。 */
export type ClaudeCodePluginIgnoredComponent = "hooks" | "mcp" | "lsp"

/** 保留的 skill 中交给 Claude Code 原有运行规则处理的声明。 */
export type ClaudeCodePluginSkillExecution = {
  name: string
  inline: boolean
  hooks: boolean
  allowedTools: boolean
}

/** 只包含披露需要的元数据、可用组件和 skill 执行项，不携带可执行配置。 */
export type ClaudeCodePluginManifest = {
  id: string
  name: string
  version: string
  description?: string | undefined
  commands: string[]
  skills: string[]
  agents: string[]
  ignoredComponents: ClaudeCodePluginIgnoredComponent[]
  skillExecution: ClaudeCodePluginSkillExecution[]
}

/** 绑定当前受信窗口和所披露的 Claude Code 插件副本。 */
export type ClaudeCodePluginInstallDisclosure = Pick<
  CapabilityPluginInstallDisclosure,
  "confirmationId" | "sourceKind" | "sha256"
> & { type: "claude-code"; manifest: ClaudeCodePluginManifest }

/** Claude Code 插件的安装记录，不含能力插件专用工具权限。 */
export type InstalledClaudeCodePlugin = Pick<
  InstalledCapabilityPlugin,
  "revision" | "installedAt" | "sourceKind" | "sha256" | "enabled" | "compatible"
> & { type: "claude-code"; manifest: ClaudeCodePluginManifest }

/** 插件页统一列出两种本机安装记录。 */
export type InstalledDesktopPlugin = InstalledCapabilityPlugin | InstalledClaudeCodePlugin

/** 插件页按披露的类型展示权限、组件和执行项。 */
export type DesktopPluginInstallDisclosure =
  CapabilityPluginInstallDisclosure | ClaudeCodePluginInstallDisclosure

/** 绑定命令或设置请求到一次安装，避免请求落到同 id 的新包。 */
export type CapabilityPluginRevision = { pluginId: string; revision: string }

/** 主进程投影的已启用贡献；工具名由会话工具桥统一生成。 */
export type CapabilityPluginDeclarations = CapabilityPluginRevision & {
  commands: CapabilityPluginCommand[]
  toolResults: Array<{ toolName: string; template: string }>
}

/** 允许输入和保存的设置值；null 清除当前值。 */
export type CapabilityPluginSettingValue = string | number | boolean | null

/** 可信界面只接收普通设置值与已配置密钥的字段名。 */
export type CapabilityPluginSettingsView = {
  values: Record<string, Exclude<CapabilityPluginSettingValue, null>>
  configuredSecrets: string[]
}

/** 宿主只传递命令当次获准插入的纯文本。 */
export type CapabilityPluginCommandResult = { insertText: string | null }

/** 一次用户命令最多插入的 UTF-16 单元数。 */
export const capabilityPluginComposerLimit = 16_384

/** 桌面安装命令的固定 IPC 前缀。 */
export const capabilityPluginChannelPrefix = "pigclaude:capability-plugins-"

/** 主进程落盘状态变更后发送的无正文事件。 */
export const capabilityPluginsChangedChannel = capabilityPluginChannelPrefix + "changed"

/** 可信设置页的插件管理桥，只有披露确认后才写入本机。 */
export type CapabilityPluginsBridge = {
  status(): Promise<{ developerMode: boolean }>
  list(): Promise<InstalledCapabilityPlugin[]>
  listDeclarations(): Promise<CapabilityPluginDeclarations[]>
  readSettings(plugin: CapabilityPluginRevision): Promise<CapabilityPluginSettingsView>
  setSetting(
    plugin: CapabilityPluginRevision,
    key: string,
    value: CapabilityPluginSettingValue,
  ): Promise<CapabilityPluginSettingsView>
  runCommand(
    plugin: CapabilityPluginRevision,
    commandId: string,
  ): Promise<CapabilityPluginCommandResult>
  pick(kind: CapabilityPluginInstallSource["kind"]): Promise<string | null>
  prepare(input: CapabilityPluginInstallSource): Promise<CapabilityPluginInstallDisclosure>
  confirm(confirmationId: string): Promise<InstalledCapabilityPlugin>
  cancel(confirmationId: string): Promise<void>
  setEnabled(pluginId: string, enabled: boolean): Promise<InstalledCapabilityPlugin>
  /** 保存该插件下次会话启动时使用的询问档。 */
  setToolApproval(
    pluginId: string,
    mode: CapabilityPluginToolApproval,
  ): Promise<InstalledCapabilityPlugin>
  uninstall(pluginId: string, keepData: boolean): Promise<void>
  subscribe(listener: () => void): () => void
}
