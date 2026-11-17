// 负责把 PigClaude 的账号、模型、权限和思考深度映射成 Pigcode 输入区需要的形状。
// 页面只消费这里的纯函数，输入区本身完全复用拷入的 Pigcode ui-composer。

import type { ClaudeAccountView } from "@pigclaude/contracts/claude-account"
import { RUNTIME_MODE_OPTIONS, type RuntimeMode } from "@pigclaude/ui-contracts"
import type {
  ComposerAgent,
  ComposerModel,
  ComposerModelCatalog,
  ComposerModelChoice,
  ComposerSubmitOptions,
  PermissionMode,
} from "@pigclaude/ui-composer"
import type {
  ClaudeModel,
  SessionEffort,
  SessionPermissionMode,
} from "../../../main/session/session-types"

/**
 * 自动选号实例的 id。和 agent id 相同，按 Pigcode 的约定就是默认实例，
 * 图标上不会出现实例角标；真实账号 id 是 UUID，不会和它冲突。
 */
export const AUTO_ACCOUNT = "claude"

/** 输入区需要的会话侧配置；页面把它展开成 Composer 的属性。 */
export type ComposerConfig = {
  agents: readonly ComposerAgent[]
  agentId: string
  modelId: string
  catalog: ComposerModelCatalog
  permissionMode: PermissionMode
  onPermissionMode: (mode: PermissionMode) => void
  planMode: boolean
  onPlanMode: (value: boolean) => void
  onSelectModel: (choice: ComposerModelChoice) => void
  onLoadModels: (instanceId: string) => void
  files: () => Promise<readonly string[]>
  draftKey: string
  smartPunctuation: boolean
}

/** 会话的权限状态在输入框里的样子：一个档位加一个计划开关。 */
export type PermissionView = { level: RuntimeMode; plan: boolean }

/** 新会话的默认档位：Claude Code 自己的默认档 `default`，即监督审批。 */
export const DEFAULT_PERMISSION_LEVEL: RuntimeMode = "approval-required"

/** Claude 会话支持独立的计划开关；每个账号实例都声明这一点，输入框才显示计划开关。 */
const CLAUDE_EXECUTION_MODES = { plan: true }

/** 输入框选中的档位 id；不是四档之一时返回 null，调用方忽略这次选择。 */
export function composerLevel(mode: PermissionMode): RuntimeMode | null {
  return RUNTIME_MODE_OPTIONS.some((option) => option.id === mode) ? (mode as RuntimeMode) : null
}

/** 档位和计划开关对应的 Claude Code 权限模式；计划开关打开时一律是 plan。 */
export function sessionPermissionMode(
  level: RuntimeMode,
  plan: false,
): Exclude<SessionPermissionMode, "plan">
export function sessionPermissionMode(level: RuntimeMode, plan: boolean): SessionPermissionMode
export function sessionPermissionMode(level: RuntimeMode, plan: boolean): SessionPermissionMode {
  if (plan) return "plan"
  switch (level) {
    case "approval-required":
      return "default"
    case "auto-accept-edits":
      return "acceptEdits"
    case "auto":
      return "auto"
    case "full-access":
      return "bypassPermissions"
  }
}

/** 把会话的 Claude Code 模式拆成档位和计划开关；plan 期间档位取打开计划前记住的 remembered。 */
export function permissionView(
  mode: SessionPermissionMode,
  remembered: RuntimeMode,
): PermissionView {
  switch (mode) {
    case "default":
      return { level: "approval-required", plan: false }
    case "acceptEdits":
      return { level: "auto-accept-edits", plan: false }
    case "auto":
      return { level: "auto", plan: false }
    case "bypassPermissions":
      return { level: "full-access", plan: false }
    case "plan":
      return { level: remembered, plan: true }
  }
}

/** 提交时选的思考档位；没选时返回 undefined，让 SDK 自己决定。 */
export function effortForComposer(
  effort: ComposerSubmitOptions["effort"],
): SessionEffort | undefined {
  switch (effort) {
    case "low":
    case "medium":
    case "high":
    case "xhigh":
    case "max":
      return effort
    default:
      return undefined
  }
}

/** 输入框用到的账号字段：名字和是否绑定代理。 */
export type ComposerAccount = Pick<ClaudeAccountView, "id" | "displayName" | "proxyId">

/** 一个账号对应的实例；直连账号在名字后标出系统网络。 */
export function composerAgent(account: ComposerAccount): ComposerAgent {
  return {
    id: account.id,
    agentId: "claude",
    label: account.proxyId === null ? `${account.displayName} · 系统网络` : account.displayName,
    executionModes: CLAUDE_EXECUTION_MODES,
  }
}

/** 会话正在用、但号池里已经没有的账号；仍是 Claude 实例，计划开关照常显示。 */
export function currentAccountAgent(accountId: string): ComposerAgent {
  return {
    id: accountId,
    agentId: "claude",
    label: "当前账号",
    executionModes: CLAUDE_EXECUTION_MODES,
  }
}

/** 账号转成模型选择器的实例；第一个是自动选号。 */
export function composerAgents(accounts: readonly ComposerAccount[]): ComposerAgent[] {
  return [
    {
      id: AUTO_ACCOUNT,
      agentId: "claude",
      label: "自动选择账号",
      executionModes: CLAUDE_EXECUTION_MODES,
    },
    ...accounts.map(composerAgent),
  ]
}

/** 每个实例的模型目录；models 为 null 表示还在加载，选择器会显示加载状态。 */
export function composerCatalog(
  agents: readonly ComposerAgent[],
  models: readonly ClaudeModel[] | null,
): ComposerModelCatalog {
  if (models === null) {
    return Object.fromEntries(agents.map((agent) => [agent.id, undefined]))
  }
  const list: ComposerModel[] = models.map((model) => ({
    id: model.id,
    label: model.displayName,
    description: model.description,
    isDefault: model.isDefault,
    efforts: model.efforts ?? [],
    ...(model.fast ? { fast: true } : {}),
  }))
  return Object.fromEntries(agents.map((agent) => [agent.id, list]))
}

/** 实例 id 对应的账号 id；自动选号返回空串，交给主进程挑号。 */
export function accountIdForAgent(agentId: string): string {
  return agentId === AUTO_ACCOUNT ? "" : agentId
}

/** 账号 id 对应的实例 id；空串表示自动选号。 */
export function agentIdForAccount(accountId: string): string {
  return accountId === "" ? AUTO_ACCOUNT : accountId
}
