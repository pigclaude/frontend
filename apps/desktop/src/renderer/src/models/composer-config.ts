// 负责把 PigClaude 的账号、模型、权限和思考深度映射成 Pigcode 输入区需要的形状。
// 页面只消费这里的纯函数，输入区本身完全复用拷入的 Pigcode ui-composer。

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
  onSelectModel: (choice: ComposerModelChoice) => void
  onLoadModels: (instanceId: string) => void
  files: () => Promise<readonly string[]>
  draftKey: string
  smartPunctuation: boolean
}

/** Pigcode 权限模式对应的 Claude 会话权限；只读和计划都落到 plan，和原版 Claude driver 一致。 */
export function sessionPermissionMode(mode: PermissionMode): SessionPermissionMode {
  switch (mode) {
    case "danger-full-access":
      return "bypassPermissions"
    case "plan":
    case "read-only":
      return "plan"
    default:
      return "default"
  }
}

/** Claude 会话权限对应的 Pigcode 权限模式；自动改文件和默认都显示成每次询问。 */
export function composerPermissionMode(mode: SessionPermissionMode): PermissionMode {
  switch (mode) {
    case "bypassPermissions":
      return "danger-full-access"
    case "plan":
      return "plan"
    default:
      return "workspace-write"
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

/** 一个账号对应的实例；直连账号在名字后标出系统网络。 */
export function composerAgent(account: {
  id: string
  displayName: string
  proxyId: string | null
}): ComposerAgent {
  return {
    id: account.id,
    agentId: "claude",
    label: account.proxyId === null ? `${account.displayName} · 系统网络` : account.displayName,
  }
}

/** 账号转成模型选择器的实例；第一个是自动选号。 */
export function composerAgents(
  accounts: readonly { id: string; displayName: string; proxyId: string | null }[],
): ComposerAgent[] {
  return [
    { id: AUTO_ACCOUNT, agentId: "claude", label: "自动选择账号" },
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
